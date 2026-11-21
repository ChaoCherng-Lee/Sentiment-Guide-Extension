// =============================================================================
// ComposeSession — all tone-check state for one compose box.
// Watches typing, runs analysis on sentence completion or after a pause, and
// drives the shared suggestion popup, this box's highlight and its badge.
// Red flags open the card straight away; yellow ones only underline the
// phrase and colour the badge — hover the phrase or click the badge to open it.
// Gmail can have several compose windows open, so there is one per box.
// =============================================================================

import { findEmoji, graphemeLength } from "../analysis/emoji"
import type { ChatContext, ChatMessage, SuggestionStyle, ToneAdvice, ToneVerdict } from "../analysis/types"
import { type CheckFailure, sendMessage } from "../messaging"
import type { FineReason } from "../settings/feedback"
import type { PlatformAdapter } from "../platforms/types"
import { boxText, caretIn, findInBox, phraseRects, placeCaret, type Span } from "../ui/box-text"
import { caretAfterEdit } from "../ui/dom-range"
import { Highlighter } from "../ui/highlight"
import { type BadgeActions, type PageState, StatusBadge } from "../ui/status-badge"
import type { SuggestionPopup } from "../ui/suggestion-popup"

const PUNCT_DEBOUNCE_MS = 80
const PAUSE_DEBOUNCE_MS = 700
/** How long Send waits for the whole-email check before letting it go anyway */
const SEND_CHECK_TIMEOUT_MS = 20_000
/** How long Send waits for a check that's still running before letting the message go (Plan 10.1) */
const SEND_WAIT_MS = 500
/** How long the pointer rests on a flagged phrase before its card opens */
const HOVER_OPEN_MS = 300
export const MIN_TEXT_LEN = 3

/**
 * Long enough to judge: 3+ characters as a person counts them ("👍🏽" is
 * one), or any emoji at all — "🙄" on its own can say plenty.
 */
export function worthChecking(text: string): boolean {
  return graphemeLength(text) >= MIN_TEXT_LEN || findEmoji(text).length > 0
}

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
  /** Hold red messages when Send is pressed (Settings → General) */
  pauseRedSends(): boolean
  /** Page-level actions for this box's badge (pause, settings, …). */
  badge: Omit<BadgeActions, "openCard">
  /** What "It's fine" teaches (Plan 9.4): where, and the message without names, emails or numbers. */
  learning: {
    /** The chat's hashed id, or "site:" + hostname */
    scope(): string
    scrub(text: string): string
  }
  /** Chat context (opt-in): recent messages as context for the model. */
  chatContext: {
    /** The last few messages, scrubbed; [] while chat context is off. */
    recent(): ChatMessage[]
    /** True once — after the first flag — to offer turning it on. */
    takeOffer(): boolean
    choose(on: boolean): void
  }
}

/** A flagged message; advice is null until step 2 returns. */
interface Flag {
  text: string
  verdict: ToneVerdict
  style: SuggestionStyle
  advice: ToneAdvice | null
  /** Indexes of advice.edits the user has applied */
  applied: Set<number>
  /** Chat messages the verdict was given with — the advice uses the same */
  recent: ChatMessage[]
  /** Flagged when Send was pressed, and the send is being held */
  heldSend?: boolean
}

export class ComposeSession {
  readonly id = crypto.randomUUID()
  private readonly highlighter: Highlighter
  private readonly badge: StatusBadge
  private readonly cleanups: (() => void)[] = []

  private lastText = ""                    // last text that was analysed
  private readonly ignored = new Set<string>()
  private inFlight = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private flag: Flag | null = null          // the flagged message on show
  private eventId: string | null = null    // Supabase event for the popup shown
  private textAfterEdit: string | null = null  // box text right after the last applied edit
  private checkingSend = false             // Send pressed; the whole text is being checked
  private hoverTimer: ReturnType<typeof setTimeout> | undefined

  constructor(readonly box: HTMLElement, private readonly deps: SessionDeps) {
    this.highlighter = new Highlighter(box)
    this.badge       = new StatusBadge(box, { ...deps.badge, openCard: () => this.openCard() })

    const onInput = () => this.onInput()
    const onKeydown = (e: KeyboardEvent) => {
      // Tab takes the first rewrite, like accepting an autocomplete
      if (e.key === "Tab" && !e.shiftKey && this.popupOpen && this.flag?.advice?.suggestion) {
        e.preventDefault()
        this.accept(0)
      }
    }
    // Resting the pointer on, or clicking, a flagged phrase opens its card
    const onPointer = (e: MouseEvent) => {
      clearTimeout(this.hoverTimer)
      if (!this.flag || this.popupOpen || !this.highlighter.hitTest(e.clientX, e.clientY)) return
      if (e.type === "click") this.openCard()
      else this.hoverTimer = setTimeout(() => this.openCard(), HOVER_OPEN_MS)
    }
    box.addEventListener("input", onInput)
    box.addEventListener("keydown", onKeydown)
    document.addEventListener("mousemove", onPointer, { passive: true })
    box.addEventListener("click", onPointer)
    this.cleanups.push(
      () => box.removeEventListener("input", onInput),
      () => box.removeEventListener("keydown", onKeydown),
      () => document.removeEventListener("mousemove", onPointer),
      () => box.removeEventListener("click", onPointer),
      deps.adapter.onSend(box, () => this.reset()),
    )
    if (deps.adapter.guardSend) {
      this.cleanups.push(deps.adapter.guardSend(box, () =>
        deps.adapter.checkWholeOnSend ? this.checkBeforeSend() : this.pauseIfRed()))
    }
    // Text typed before this box was picked up (or a saved draft) is checked too
    if (this.text) this.onInput()
  }

  /** Everything the user wrote in the box. */
  private get text() {
    return this.deps.adapter.getText(this.box)
  }

  /** What a pause checks: the whole message, or for email the paragraph being edited. */
  private get checkText() {
    return this.deps.adapter.getEditingText?.(this.box) ?? this.text
  }

  private get popupOpen() {
    return this.deps.popup.isOpenFor(this)
  }

  // ── Badge ─────────────────────────────────────────────────────────────────

  /** AI status, pause or chat-off — the same for every box on the page. */
  setPageState(state: PageState) {
    this.badge.setPage(state)
  }

  /** Hidden while the extension is switched off. */
  setHidden(hidden: boolean) {
    this.badge.setHidden(hidden)
  }

  /** Open the card for the flagged message (badge click, or hovering the phrase). */
  private openCard() {
    if (this.flag && !this.popupOpen) this.showPopup()
  }

  // ── Typing ────────────────────────────────────────────────────────────────

  private onInput() {
    clearTimeout(this.timer)
    // Typing on after "It's fine" closes the "what was it?" question
    if (!this.flag && this.popupOpen) this.deps.popup.hide()
    if (!this.deps.isActive()) return
    this.highlighter.refresh()
    if (!this.text) { this.clearUI(); this.badge.setBox({ kind: "idle" }); return }

    const text = this.checkText
    if (!text || !worthChecking(text)) return
    if (this.ignored.has(text)) return

    const delay = /[.!?]$/.test(text) ? PUNCT_DEBOUNCE_MS : PAUSE_DEBOUNCE_MS
    this.timer = setTimeout(() => this.analyse(text), delay)
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  private async analyse(text: string) {
    // A verdict is on its way — when it lands it re-checks the latest text
    if (this.inFlight) return
    // Send is checking the whole text; a pause check would replace that request
    if (this.checkingSend) return
    if (text === this.lastText || this.ignored.has(text)) return

    this.inFlight = true
    this.lastText = text
    const conv    = this.deps.conversation()
    const recent  = this.deps.chatContext.recent()
    // A flag stays on show until its re-check says otherwise
    if (this.badge.boxKind !== "flagged") this.badge.setBox({ kind: "checking" })

    // Step 1: fast verdict
    const res = await sendMessage({ type: "CHECK_TONE", text, context: conv.context, recent, sessionId: this.id, scope: this.deps.learning.scope() })
    this.inFlight = false
    if (res && !res.ok && res.reason === "language" && this.checkText === text) {
      // Said on the badge; the same text isn't sent again (lastText stays)
      this.clearUI()
      this.badge.setBox({ kind: "language", language: res.language ?? "unknown" })
      return
    }
    if (!res || !res.ok) {
      if (res && res.reason !== "cancelled") this.deps.onCheckDone(res)
      // Not checked — let the next keystroke try again
      this.lastText = ""
      if (this.badge.boxKind === "checking") this.badge.setBox({ kind: "idle" })
      return
    }
    this.deps.onCheckDone({ ok: true })

    // Drop stale results: the box changed while the model was thinking.
    // Re-check whatever is there now instead.
    const current = this.checkText
    if (current !== text) {
      if (worthChecking(current)) this.analyse(current)
      else if (this.badge.boxKind === "checking") this.badge.setBox({ kind: "idle" })
      return
    }

    // Turned off while the model was thinking
    if (!this.deps.isActive()) return

    const { verdict } = res
    if (verdict.tone === "green") {
      this.clearUI()
      this.badge.setBox({ kind: "fine" })
      return
    }
    this.badge.setBox({ kind: "flagged", tone: verdict.tone })

    // Still flagged after applying an edit: if other edits from the same
    // advice are still waiting, keep them on screen instead of starting over
    if (text === this.textAfterEdit && this.flag && this.hasPendingEdits(this.flag)) {
      this.flag.text    = text
      this.flag.verdict = verdict
      this.highlighter.show(verdict.flagged_phrase, verdict.tone)
      return
    }

    // Flag it straight away, then fill in the explanation and rewrite.
    // Red opens the card now; yellow waits until the user looks (badge or hover).
    this.flag    = { text, verdict, style: this.deps.style(), advice: null, applied: new Set(), recent }
    this.eventId = crypto.randomUUID()
    this.highlighter.show(verdict.flagged_phrase, verdict.tone)
    if (verdict.tone === "red") this.showPopup()
    else if (this.popupOpen) this.deps.popup.hide()
    this.fetchAdvice(this.flag, conv)
  }

  /** Step 2: explanation + kinder rewrite for the flagged message. */
  private async fetchAdvice(flag: Flag, conv: { id: string | null; context: ChatContext | null }) {
    const res = await sendMessage({
      type:        "GET_ADVICE",
      text:        flag.text,
      verdict:     flag.verdict,
      context:     conv.context,
      recent:      flag.recent,
      style:       flag.style,
      eventId:     this.eventId!,
      platform:    this.deps.adapter.id,
      sessionId:   this.id,
    })
    // Superseded by newer text, dismissed or sent in the meantime
    if (this.flag !== flag || !res) return
    if (!res.ok) {
      if (res.reason === "cancelled" || res.reason === "paused") return
      this.deps.onCheckDone(res)
      flag.advice = { label: "", category: "other", explanation: "Couldn't come up with a suggestion this time.", suggestion: "", alternatives: [], edits: [], emoji_notes: [] }
    } else {
      flag.advice = res.advice
    }
    if (this.popupOpen) this.deps.popup.setAdvice(flag.advice)
  }

  /**
   * Send was pressed (email): check the whole text first. Resolves true to
   * let it go. A failed or slow check never stops anyone sending.
   */
  private async checkBeforeSend(): Promise<boolean> {
    if (!this.deps.isActive()) return true
    const text = this.text
    if (!worthChecking(text) || this.ignored.has(text)) return true

    const conv   = this.deps.conversation()
    const recent = this.deps.chatContext.recent()
    clearTimeout(this.timer)
    this.checkingSend = true
    this.badge.setBox({ kind: "checking" })
    const res = await Promise.race([
      sendMessage({ type: "CHECK_TONE", text, context: conv.context, recent, sessionId: this.id }),
      new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), SEND_CHECK_TIMEOUT_MS)),
    ]).finally(() => { this.checkingSend = false })
    if (!res?.ok || res.verdict.tone === "green" || !this.deps.isActive() || this.text !== text) {
      this.badge.setBox({ kind: res?.ok && res.verdict.tone === "green" ? "fine" : "idle" })
      return true
    }
    this.badge.setBox({ kind: "flagged", tone: res.verdict.tone })

    this.lastText = text
    this.flag     = { text, verdict: res.verdict, style: this.deps.style(), advice: null, applied: new Set(), recent, heldSend: true }
    this.eventId  = crypto.randomUUID()
    this.highlighter.show(res.verdict.flagged_phrase, res.verdict.tone)
    this.showPopup()
    this.fetchAdvice(this.flag, conv)
    return false
  }

  /**
   * Send was pressed in a chat (Plan 10.1): hold it only if the message is
   * red. A check still running gets SEND_WAIT_MS; after that it goes.
   */
  private pauseIfRed(): boolean | Promise<boolean> {
    if (!this.deps.isActive() || !this.deps.pauseRedSends()) return true
    const text = this.text
    if (!worthChecking(text) || this.ignored.has(text)) return true
    if (this.flag?.text === text) return this.holdIfRed()
    // Not checked yet (or still checking): start now and wait a moment
    if (text !== this.lastText) { clearTimeout(this.timer); this.analyse(text) }
    const deadline = Date.now() + SEND_WAIT_MS
    return new Promise(resolve => {
      const poll = () => {
        if (this.flag?.text === text) return resolve(this.holdIfRed())
        const done = this.lastText === text && !this.inFlight
        if (done || Date.now() >= deadline || this.text !== text) return resolve(true)
        setTimeout(poll, 25)
      }
      poll()
    })
  }

  private holdIfRed(): boolean {
    if (!this.flag || this.flag.verdict.tone !== "red") return true
    this.flag.heldSend = true
    this.showPopup()
    return false
  }

  /** "Send anyway" on a held send. */
  private sendAnyway() {
    this.reportAcceptance(false)
    this.ignored.add(this.text)
    this.clearUI()
    this.deps.adapter.sendNow?.(this.box)
  }

  private showPopup() {
    if (!this.flag) return
    const { verdict, advice, style, recent, heldSend } = this.flag
    const anchor = phraseRects(this.box, verdict.flagged_phrase)?.[0] ?? this.box.getBoundingClientRect()
    const scope  = this.deps.badge.scope
    this.deps.popup.show(this, verdict, advice, style, anchor, {
      onAccept:       (i) => this.accept(i),
      onApplyEdit:    (i) => this.applyEdit(i),
      onDismiss:      () => this.dismiss(),
      onClose:        () => this.deps.popup.hide(),
      onEditContext:  () => { this.deps.popup.hide(); this.deps.onEditContext() },
      onDisableChat:  () => this.deps.onDisableChat(),
      onOpenSettings: () => this.deps.badge.openSettings(),
      onStyleChange:  (s) => this.changeStyle(s),
      onChatContextChoice: (on) => this.chooseChatContext(on),
      onSendAnyway: heldSend ? () => this.sendAnyway() : undefined,
    }, {
      chat: { used: recent.length > 0, offer: this.deps.chatContext.takeOffer() },
      scope,
      canEditContext: scope === "chat",
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
    // Still the same flagged message: shared (and counted) once
    this.eventId ??= crypto.randomUUID()
    this.deps.popup.setAdvice(null)
    this.fetchAdvice(this.flag, this.deps.conversation())
  }

  /** Answer to the chat-context offer. Turning it on re-checks this message with the chat. */
  private chooseChatContext(on: boolean) {
    this.deps.chatContext.choose(on)
    if (!on) return
    const text = this.text
    this.lastText = ""
    if (worthChecking(text)) this.analyse(text)
  }

  private reportAcceptance(accepted: boolean) {
    if (!this.eventId) return
    sendMessage({ type: "UPDATE_ACCEPTANCE", eventId: this.eventId, accepted })
    this.eventId = null
  }

  /**
   * "It's fine": leave this message alone. The card stays a moment to ask
   * why (optional); the answer is counted on this computer only.
   */
  dismiss() {
    const flag    = this.flag
    const eventId = this.eventId ?? crypto.randomUUID()
    const text    = this.text
    if (text) this.ignored.add(text)
    this.reportAcceptance(false)
    const asking = flag && this.popupOpen
    if (asking) {
      // Clear the flag but keep the card, which now asks "what was it?"
      this.flag = null
      this.textAfterEdit = null
      this.highlighter.clear()
      if (this.badge.boxKind === "flagged") this.badge.setBox({ kind: "idle" })
    } else {
      this.clearUI()
    }
    if (!flag) return
    const tone = flag.verdict.tone === "red" ? "red" : "yellow"
    const learn = text ? { snippet: this.deps.learning.scrub(text), scope: this.deps.learning.scope() } : {}
    const report = (reason: FineReason | null) =>
      sendMessage({ type: "FINE_FEEDBACK", eventId, tone, reason, ...learn })
    if (asking) this.deps.popup.askWhyFine(report)
    else report(null)
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

    const at = findInBox(this.box, edit.original)
    if (!at) { popup.setEditState(index, "missing"); return }
    // Removing an emoji: take one neighbouring space with it so no double space is left
    if (!edit.replacement) {
      const full = boxText(this.box)
      if (full[at.start - 1] === " ") at.start--
      else if (full[at.end] === " ") at.end++
    }

    const caret    = caretIn(this.box)
    const replaced = await this.deps.adapter.replaceText(this.box, at, edit.replacement)
    if (this.flag !== flag) return
    flag.applied.add(index)

    if (replaced && this.text.includes(edit.replacement)) {
      this.textAfterEdit = this.text
      this.reportAcceptance(true)
      popup.setEditState(index, "applied")
      if (caret !== null) placeCaret(this.box, caretAfterEdit(caret, at.start, at.end, edit.replacement.length))
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

  /** Use rewrite `index` (0 = the first, then the alternatives). */
  async accept(index = 0) {
    const flag       = this.flag
    const advice     = flag?.advice
    const suggestion = advice ? [advice.suggestion, ...advice.alternatives][index] || advice.suggestion : ""
    if (!flag || !suggestion) return
    const popup = this.deps.popup

    // Email: replace just the paragraph (or text) that was checked, not quotes or other paragraphs
    const target: Span | "all" | null = this.deps.adapter.getEditingText ? findInBox(this.box, flag.text) : "all"
    const replaced = target !== null && await this.deps.adapter.replaceText(this.box, target, suggestion)
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
    clearTimeout(this.hoverTimer)
    this.highlighter.clear()
    if (this.popupOpen) this.deps.popup.hide()
    if (this.badge.boxKind === "flagged") this.badge.setBox({ kind: "idle" })
    this.flag          = null
    this.textAfterEdit = null
  }

  /** Forget everything — after sending or switching chats. */
  reset() {
    clearTimeout(this.timer)
    this.clearUI()
    this.badge.setBox({ kind: "idle" })
    this.ignored.clear()
    this.lastText = ""
    this.eventId  = null
  }

  dispose() {
    this.reset()
    this.cleanups.forEach(fn => fn())
    this.badge.dispose()
  }
}
