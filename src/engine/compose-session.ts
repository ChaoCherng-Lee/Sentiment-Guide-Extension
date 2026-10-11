// =============================================================================
// ComposeSession — all tone-check state for one compose box.
// Watches typing, runs analysis on sentence completion or after a pause, and
// drives the shared suggestion popup and this box's highlight.
// Gmail can have several compose windows open, so there is one per box.
// =============================================================================

import type { ChatContext, ToneResult } from "../analysis/types"
import { type CheckFailure, sendMessage } from "../messaging"
import type { PlatformAdapter } from "../platforms/types"
import { getPhraseRange } from "../ui/dom-range"
import { Highlighter } from "../ui/highlight"
import type { SuggestionPopup } from "../ui/suggestion-popup"

const PUNCT_DEBOUNCE_MS = 80
const PAUSE_DEBOUNCE_MS = 1200
export const MIN_TEXT_LEN = 3

export interface SessionDeps {
  adapter: PlatformAdapter
  popup: SuggestionPopup
  /** Current conversation — read at request time so chat switches apply. */
  conversation(): { id: string | null; context: ChatContext | null }
  onEditContext(): void
  /** Every finished check reports here, so the engine can show AI status. */
  onCheckDone(outcome: { ok: true } | { ok: false; reason: CheckFailure }): void
}

export class ComposeSession {
  readonly id = crypto.randomUUID()
  private readonly highlighter: Highlighter
  private readonly cleanups: (() => void)[] = []

  private lastText = ""                    // last text that was analysed
  private readonly ignored = new Set<string>()
  private inFlight = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private result: ToneResult | null = null
  private eventId: string | null = null    // Supabase event for the popup shown

  constructor(readonly box: HTMLElement, private readonly deps: SessionDeps) {
    this.highlighter = new Highlighter(box)

    const onInput = () => this.onInput()
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && this.popupOpen && this.result?.suggestion) {
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
    const text = this.text
    clearTimeout(this.timer)
    this.highlighter.refresh()

    if (!text) { this.clearUI(); return }
    if (text.length < MIN_TEXT_LEN) return
    if (this.ignored.has(text)) return

    const delay = /[.!?]$/.test(text) ? PUNCT_DEBOUNCE_MS : PAUSE_DEBOUNCE_MS
    this.timer = setTimeout(() => this.analyse(text), delay)
  }

  // ── Analysis ──────────────────────────────────────────────────────────────

  private async analyse(text: string) {
    // A request is running — when it lands it re-checks the latest text
    if (this.inFlight) return
    if (text === this.lastText || this.ignored.has(text)) return

    this.inFlight = true
    this.lastText = text
    const eventId = crypto.randomUUID()
    const conv    = this.deps.conversation()

    const res = await sendMessage({
      type:        "CHECK_TONE",
      text,
      context:     conv.context,
      eventId,
      contactHash: conv.id,
      sessionId:   this.id,
    })
    this.inFlight = false
    if (!res) return
    if (!res.ok) {
      if (res.reason !== "cancelled") this.deps.onCheckDone(res)
      // Not checked — let the next keystroke try again
      this.lastText = ""
      return
    }
    this.deps.onCheckDone({ ok: true })
    const result = res.result

    // Drop stale results: the box changed while the model was thinking.
    // Re-check whatever is there now instead.
    const current = this.text
    if (current !== text) {
      if (current.length >= MIN_TEXT_LEN) this.analyse(current)
      return
    }

    if (result.tone === "green") { this.clearUI(); return }

    this.result  = result
    this.eventId = eventId
    this.highlighter.show(result.flagged_phrase, result.tone)
    this.showPopup()
  }

  private showPopup() {
    if (!this.result) return
    const range  = getPhraseRange(this.box, this.result.flagged_phrase)
    const anchor = range?.getClientRects()[0] ?? this.box.getBoundingClientRect()
    this.deps.popup.show(this, this.result, anchor, {
      onAccept:      () => this.accept(),
      onDismiss:     () => this.dismiss(),
      onEditContext: () => { this.deps.popup.hide(); this.deps.onEditContext() },
    })
  }

  // ── User actions ──────────────────────────────────────────────────────────

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

  async accept() {
    const suggestion = this.result?.suggestion
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
    this.result = null
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
