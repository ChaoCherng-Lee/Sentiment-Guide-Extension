// =============================================================================
// ComposeSession — all tone-check state for one compose box.
// Watches typing, runs analysis on sentence completion or after a pause, and
// drives the shared suggestion popup and this box's highlight.
// Gmail can have several compose windows open, so there is one per box.
// =============================================================================

import type { ChatContext, SuggestionStyle, ToneAdvice, ToneVerdict } from "../analysis/types"
import { type CheckFailure, sendMessage } from "../messaging"
import type { PlatformAdapter } from "../platforms/types"
import { caretAfterEdit, findPhrase, getCaretOffset, getPhraseRange, rangeFromOffsets, setCaretOffset } from "../ui/dom-range"
import { Highlighter } from "../ui/highlight"
import type { SuggestionPopup } from "../ui/suggestion-popup"

const PUNCT_DEBOUNCE_MS = 80
const PAUSE_DEBOUNCE_MS = 1200
export const MIN_TEXT_LEN = 3

export interface SessionDeps {
  adapter: PlatformAdapter
  popup: SuggestionPopup
  /** False while the extension is off, paused, or off for this chat. */
  isActive(): boolean
  /** Current conversation — read at request time so chat switches apply. */
  conversation(): { id: string | null; context: ChatContext | null }
  onEditContext(): void
  onDisableChat(): void
  /** Style for rewrites in the current chat. */
  style(): SuggestionStyle
  /** Remember a style picked in the popup for the current chat. */
  onStyleChange(style: SuggestionStyle): void
  /** Every finished check reports here, so the engine can show AI status. */
  onCheckDone(outcome: { ok: true } | { ok: false; reason: CheckFailure }): void
}

/** A flagged message; advice is null until step 2 returns. */
interface Flag {
  text: string
  verdict: ToneVerdict
  style: SuggestionStyle
  advice: ToneAdvice | null
  /** Indexes of advice.edits the user has applied */
  applied: Set<number>
}

export class ComposeSession {
  readonly id = crypto.randomUUID()
  private readonly highlighter: Highlighter
  private readonly cleanups: (() => void)[] = []

  private lastText = ""                    // last text that was analysed
  private readonly ignored = new Set<string>()
  private inFlight = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private flag: Flag | null = null          // the flagged message on show
  private eventId: string | null = null    // Supabase event for the popup shown
  private textAfterEdit: string | null = null  // box text right after the last applied edit

  constructor(readonly box: HTMLElement, private readonly deps: SessionDeps) {
    this.highlighter = new Highlighter(box)

    const onInput = () => this.onInput()
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && this.popupOpen && this.flag?.advice?.suggestion) {
        e.preventDefault()
        this.accept()
      }
    }
    box.addEventListener("input", onInput)
    box.addEventListener("keydown", onKeydown)
    this.cleanups.push(
      () => box.removeEventListener("input", onInput),
      () => box.removeEventListener("keydown", onKeydown),
      deps.adapter.onSend(box, () => this.reset()),
    )
  }

  private get text() {
    return this.deps.adapter.getText(this.box)
  }

  private get popupOpen() {
    return this.deps.popup.isOpenFor(this)
  }

  // ── Typing ────────────────────────────────────────────────────────────────

  private onInput() {
    clearTimeout(this.timer)
    if (!this.deps.isActive()) return
    const text = this.text
    this.highlighter.refresh()

    if (!text) { this.clearUI(); return }
    if (text.length < MIN_TEXT_LEN) return
    if (this.ignored.has(text)) return

    const delay = /[.!?]$/.test(text) ? PUNCT_DEBOUNCE_MS : PAUSE_DEBOUNCE_MS
    this.timer = setTimeout(() => this.analyse(text), delay)
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  private async analyse(text: string) {
    // A verdict is on its way — when it lands it re-checks the latest text
    if (this.inFlight) return
    if (text === this.lastText || this.ignored.has(text)) return

    this.inFlight = true
    this.lastText = text
    const conv    = this.deps.conversation()

    // Step 1: fast verdict
    const res = await sendMessage({ type: "CHECK_TONE", text, context: conv.context, sessionId: this.id })
    this.inFlight = false
    if (!res) return
    if (!res.ok) {
      if (res.reason !== "cancelled") this.deps.onCheckDone(res)
      // Not checked — let the next keystroke try again
      this.lastText = ""
      return
    }
    this.deps.onCheckDone({ ok: true })

    // Drop stale results: the box changed while the model was thinking.
    // Re-check whatever is there now instead.
    const current = this.text
    if (current !== text) {
      if (current.length >= MIN_TEXT_LEN) this.analyse(current)
      return
    }

    // Turned off while the model was thinking
    if (!this.deps.isActive()) return

    const { verdict } = res
    if (verdict.tone === "green") { this.clearUI(); return }

    // Still flagged after applying an edit: if other edits from the same
    // advice are still waiting, keep them on screen instead of starting over
    if (text === this.textAfterEdit && this.flag && this.hasPendingEdits(this.flag)) {
      this.flag.text    = text
      this.flag.verdict = verdict
      this.highlighter.show(verdict.flagged_phrase, verdict.tone)
      return
    }

    // Flag it straight away, then fill in the explanation and rewrite
    this.flag    = { text, verdict, style: this.deps.style(), advice: null, applied: new Set() }
    this.eventId = crypto.randomUUID()
    this.highlighter.show(verdict.flagged_phrase, verdict.tone)
    this.showPopup()
    this.fetchAdvice(this.flag, conv)
  }

  /** Step 2: explanation + kinder rewrite for the flagged message. */
  private async fetchAdvice(flag: Flag, conv: { id: string | null; context: ChatContext | null }) {
    const res = await sendMessage({
      type:        "GET_ADVICE",
      text:        flag.text,
      verdict:     flag.verdict,
      context:     conv.context,
      style:       flag.style,
      eventId:     this.eventId!,
      contactHash: conv.id,
      sessionId:   this.id,
    })
    // Superseded by newer text, dismissed or sent in the meantime
    if (this.flag !== flag || !res) return
    if (!res.ok) {
      if (res.reason === "cancelled" || res.reason === "paused") return
      this.deps.onCheckDone(res)
      flag.advice = { label: "", explanation: "Couldn't come up with a suggestion this time.", suggestion: "", edits: [] }
    } else {
      flag.advice = res.advice
    }
    if (this.popupOpen) this.deps.popup.setAdvice(flag.advice)
  }

  private showPopup() {
    if (!this.flag) return
    const { verdict, advice, style } = this.flag
    const range  = getPhraseRange(this.box, verdict.flagged_phrase)
    const anchor = range?.getClientRects()[0] ?? this.box.getBoundingClientRect()
    this.deps.popup.show(this, verdict, advice, style, anchor, {
      onAccept:      () => this.accept(),
      onApplyEdit:   (i) => this.applyEdit(i),
      onDismiss:     () => this.dismiss(),
      onEditContext: () => { this.deps.popup.hide(); this.deps.onEditContext() },
      onDisableChat: () => this.deps.onDisableChat(),
      onStyleChange: (s) => this.changeStyle(s),
    })
  }

  // ── User actions ──────────────────────────────────────────────────────────

  /** Rewrite the flagged message again in another style. */
  private changeStyle(style: SuggestionStyle) {
    const old = this.flag
    if (!old) return
    this.deps.onStyleChange(style)
    // A new Flag object, so a rewrite still on its way for the old style is ignored
    this.flag    = { ...old, style, advice: null, applied: new Set() }
    this.eventId = crypto.randomUUID()
    this.deps.popup.setAdvice(null)
    this.fetchAdvice(this.flag, this.deps.conversation())
  }

  private reportAcceptance(accepted: boolean) {
    if (!this.eventId) return
    sendMessage({ type: "UPDATE_ACCEPTANCE", eventId: this.eventId, accepted })
    this.eventId = null
  }

  dismiss() {
    const text = this.text
    if (text) this.ignored.add(text)
    this.reportAcceptance(false)
    this.clearUI()
  }

  /** Edits of this flag not yet applied whose words are still in the message. */
  private hasPendingEdits(flag: Flag) {
    const text = this.text.toLowerCase()
    return (flag.advice?.edits ?? []).some((e, i) => !flag.applied.has(i) && text.includes(e.original.toLowerCase()))
  }

  /**
   * Swap one phrase for its kinder version and leave the rest of the message,
   * and the caret, where they were. The input event that follows re-checks
   * the message.
   */
  async applyEdit(index: number) {
    const flag = this.flag
    const edit = flag?.advice?.edits[index]
    if (!flag || !edit || flag.applied.has(index)) return
    const popup = this.deps.popup

    const at    = findPhrase(this.box, edit.original)
    const range = at && rangeFromOffsets(this.box, at.start, at.end)
    if (!at || !range) { popup.setEditState(index, "missing"); return }

    const caret    = getCaretOffset(this.box)
    const replaced = await this.deps.adapter.replaceText(this.box, range, edit.replacement)
    if (this.flag !== flag) return
    flag.applied.add(index)

    if (replaced && this.text.includes(edit.replacement)) {
      this.textAfterEdit = this.text
      this.reportAcceptance(true)
      popup.setEditState(index, "applied")
      if (caret !== null) setCaretOffset(this.box, caretAfterEdit(caret, at.start, at.end, edit.replacement.length))
      // Nothing left to apply here — let the re-check decide what comes next
      if (!this.hasPendingEdits(flag)) popup.hide()
      return
    }

    // The editor refused the edit — hand the words over via the clipboard
    try {
      await navigator.clipboard.writeText(edit.replacement)
      popup.setEditState(index, "copied")
    } catch (_) {
      popup.setEditState(index, "failed")
    }
  }

  async accept() {
    const suggestion = this.flag?.advice?.suggestion
    if (!suggestion) return
    const popup = this.deps.popup

    const replaced = await this.deps.adapter.replaceText(this.box, "all", suggestion)
    if (replaced) {
      this.reportAcceptance(true)
      popup.setAcceptLabel("✓ Replaced!")
      setTimeout(() => { this.clearUI(); this.lastText = "" }, 1500)
      return
    }

    // The editor refused the edit — hand the text over via the clipboard
    try {
      await navigator.clipboard.writeText(suggestion)
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
      popup.setAcceptLabel(`✓ Copied — paste (${isMac ? "Cmd" : "Ctrl"}+V)`)
      setTimeout(() => { this.clearUI(); this.lastText = "" }, 3000)
    } catch (_) {
      popup.setAcceptLabel("Couldn't replace — copy it manually")
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private clearUI() {
    this.highlighter.clear()
    if (this.popupOpen) this.deps.popup.hide()
    this.flag          = null
    this.textAfterEdit = null
  }

  /** Forget everything — after sending or switching chats. */
  reset() {
    clearTimeout(this.timer)
    this.clearUI()
    this.ignored.clear()
    this.lastText = ""
    this.eventId  = null
  }

  dispose() {
    this.reset()
    this.cleanups.forEach(fn => fn())
  }
}
