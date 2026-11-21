// =============================================================================
// Suggestion popup — Grammarly-style card shown above the flagged phrase.
// One instance per page, shared by every compose box; `owner` records which
// compose session it is currently showing for.
// Kept short: the reason, the phrase fixes, the full rewrite. Less-used
// actions (edit context, stop checking this chat, settings) sit behind "⋯".
// Lives in a Shadow DOM host so styles never leak into the page.
// =============================================================================

import { SUGGESTION_STYLES, type SuggestionStyle, type ToneAdvice, type ToneVerdict } from "../analysis/types"
import { FINE_REASON_LABELS, FINE_REASONS, type FineReason } from "../settings/feedback"

/** How long the "what was it?" question stays before the card closes by itself */
const FINE_ASK_MS = 8000

/** What happened to one phrase edit after the user clicked Apply. */
export type EditState = "applied" | "copied" | "missing" | "failed"

const EDIT_STATE_LABELS: Record<EditState, string> = {
  applied: "✓ Applied",
  copied:  "✓ Copied — paste it in",
  missing: "Not in your message anymore",
  failed:  "Couldn't change it — edit it yourself",
}

export interface PopupHandlers {
  /** Use rewrite `index`: 0 is the first, then the alternatives */
  onAccept(index: number): void
  /** Apply advice.edits[index] only. */
  onApplyEdit(index: number): void
  /** "It's fine": leave this message alone (the card then asks why, see askWhyFine). */
  onDismiss(): void
  /** ×: close the card; the message stays flagged and can be reopened. */
  onClose(): void
  onEditContext(): void
  onDisableChat(): void
  onOpenSettings(): void
  /** The user picked another style — the owner should fetch a new rewrite. */
  onStyleChange(style: SuggestionStyle): void
  /** Answer to the one-time "use the chat as context?" offer. */
  onChatContextChoice(on: boolean): void
  /** Only while Send is being held (email): send it as it is. */
  onSendAnyway?(): void
}

/** Chat context for this check: whether it was used, and whether to offer it. */
export interface ChatContextState {
  used: boolean
  offer: boolean
}

/** What the card offers on this site. */
export interface PopupOptions {
  chat?: ChatContextState
  /** "chat" on messaging sites; "site" on other websites */
  scope?: "chat" | "site"
  /** Whether "Edit context" makes sense here (not on general websites) */
  canEditContext?: boolean
}

const STYLE_LABELS: Record<SuggestionStyle, string> = { casual: "Casual", formal: "Formal", direct: "Direct" }

const ACCEPT_LABEL = "Replace all (Tab)"
/** About how tall the card is with its advice, for choosing above or below */
const CARD_HEIGHT = 340

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .popup {
    background: white;
    border-radius: 12px;
    padding: 12px 14px;
    min-width: 280px;
    max-width: 330px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    border: 1px solid #eee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #111827;
    position: fixed;
    z-index: 2147483647;
    pointer-events: auto;
    display: none;
  }

  .popup::before {
    content: '';
    position: absolute;
    top: 100%;
    left: var(--caret-left, 50%);
    transform: translateX(-50%);
    border: 8px solid transparent;
    border-top-color: #eee;
  }

  .popup::after {
    content: '';
    position: absolute;
    top: calc(100% - 1px);
    left: var(--caret-left, 50%);
    transform: translateX(-50%);
    border: 7px solid transparent;
    border-top-color: white;
  }

  /* Below the words (no room above): the caret points up */
  .popup.below::before { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: #eee; }
  .popup.below::after  { top: auto; bottom: calc(100% - 1px); border-top-color: transparent; border-bottom-color: white; }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .tone-badge { display: flex; align-items: center; gap: 6px; }

  .tone-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .tone-dot.yellow { background: #F59E0B; }
  .tone-dot.red    { background: #DC2626; }

  .tone-label { font-weight: 600; font-size: 13px; }
  .yellow .tone-label { color: #92400E; }
  .red    .tone-label { color: #7F1D1D; }

  .header-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .icon-btn {
    background: none; border: none; cursor: pointer; border-radius: 6px;
    color: #9ca3af; font-size: 16px; padding: 0 6px; line-height: 22px;
    flex-shrink: 0; font-family: inherit;
  }
  .icon-btn:hover, .icon-btn[aria-expanded="true"] { color: #374151; background: #f3f4f6; }
  .icon-btn.close { font-size: 18px; }

  .more-menu {
    display: none; position: absolute; right: 10px; top: 36px; z-index: 1;
    background: white; border: 1px solid #e5e7eb; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(15,23,42,0.14); padding: 4px; min-width: 190px;
  }
  .more-menu.open { display: block; }
  .more-menu button {
    display: block; width: 100%; text-align: left; padding: 6px 8px; border-radius: 6px;
    border: none; background: none; font: inherit; font-size: 12px; color: #111827; cursor: pointer;
  }
  .more-menu button:hover, .more-menu button:focus-visible { background: #f3f4f6; outline: none; }

  .confidence-text { font-size: 11px; color: #9ca3af; font-style: italic; display: none; }

  .explanation { font-size: 12px; color: #555; margin-bottom: 10px; line-height: 1.6; }
  .explanation.pending { color: #9ca3af; font-style: italic; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.45; } }

  .emoji-notes { margin: -4px 0 10px; display: flex; flex-direction: column; gap: 2px; }
  .emoji-note { font-size: 11px; color: #6b7280; }
  .emoji-note .emoji { font-size: 13px; margin-right: 4px; font-style: normal; }
  .edit-to.remove { color: #6b7280; font-style: italic; font-weight: 400; }

  .edits { margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
  .edit-row {
    display: flex; align-items: center; gap: 8px;
    border: 1px solid #f0f0f0; border-radius: 8px; padding: 6px 8px;
  }
  .edit-body { flex: 1; min-width: 0; font-size: 12px; line-height: 1.45; }
  .edit-from { color: #9ca3af; text-decoration: line-through; }
  .edit-arrow { color: #9ca3af; margin: 0 3px; }
  .edit-to { color: #065f46; font-weight: 500; }
  .edit-reason { font-size: 11px; color: #9ca3af; }
  .btn-apply {
    flex-shrink: 0; padding: 3px 10px; border-radius: 14px;
    background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0;
    font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit;
  }
  .btn-apply:hover { background: #d1fae5; }
  .btn-apply:disabled { background: none; border-color: transparent; color: #6b7280; cursor: default; font-weight: 500; }
  .edit-row.done .edit-body { opacity: 0.6; }

  .suggestion-box { background: #f7f7f7; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
  .suggestion-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }

  .style-row { display: flex; align-items: center; gap: 3px; }
  .style-chip {
    padding: 1px 9px; border-radius: 99px; border: 1px solid #e5e7eb;
    background: white; color: #4b5563; font-size: 11px; font-weight: 500; line-height: 1.6;
    font-family: inherit; cursor: pointer;
  }
  .style-chip:hover { background: #f3f4f6; }
  .style-chip[aria-pressed="true"] { background: #eef2ff; border-color: #a5b4fc; color: #3730a3; }
  .suggestion-label { font-size: 11px; font-weight: 500; color: #888; }
  .suggestion-text { font-size: 12px; font-style: italic; color: #333; line-height: 1.5; }
  .rewrites { display: flex; flex-direction: column; gap: 4px; }
  .rewrite-choice {
    text-align: left; font: italic 12px/1.5 inherit; font-family: inherit; color: #333;
    background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 8px; cursor: pointer;
  }
  .rewrite-choice:hover { border-color: #c7d2fe; }
  .rewrite-choice[aria-checked="true"] { border-color: #6366f1; background: #eef2ff; }
  .rewrite-choice:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 1px; }

  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  .btn-accept {
    padding: 6px 16px; border-radius: 20px;
    background: #2563EB; color: white;
    border: none; font-size: 12px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  .btn-accept:hover { background: #1D4ED8; }

  .btn-dismiss {
    padding: 6px 14px; border-radius: 20px;
    background: transparent; color: #888;
    border: 1px solid #ddd; font-size: 12px;
    cursor: pointer; font-family: inherit;
  }
  .btn-dismiss:hover { background: #f3f4f6; color: #555; }

  .context-note { font-size: 11px; color: #6b7280; margin: -4px 0 8px; display: none; }

  .offer {
    display: none; margin-top: 10px; padding: 10px 12px;
    background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px;
  }
  .offer-title { font-size: 12px; font-weight: 600; color: #4c1d95; margin-bottom: 2px; }
  .offer-text { font-size: 11px; color: #5b21b6; line-height: 1.5; margin-bottom: 8px; }
  .offer-actions { display: flex; gap: 6px; }
  .offer-actions button {
    padding: 3px 12px; border-radius: 14px; font-size: 11px; font-weight: 600;
    font-family: inherit; cursor: pointer; border: 1px solid #c4b5fd; background: white; color: #5b21b6;
  }
  .offer-actions .offer-yes { background: #7c3aed; border-color: #7c3aed; color: white; }
  .offer-actions .offer-yes:hover { background: #6d28d9; }
  .offer-done { font-size: 11px; color: #5b21b6; }

  .fine-title { font-size: 12px; font-weight: 600; color: #065f46; margin-bottom: 2px; }
  .fine-text { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
  .fine-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .fine-chip {
    padding: 3px 10px; border-radius: 14px; font-size: 11px; font-weight: 500;
    font-family: inherit; cursor: pointer; border: 1px solid #e5e7eb; background: white; color: #374151;
  }
  .fine-chip:hover, .fine-chip:focus-visible { background: #f3f4f6; }
  .popup.thanks .tone-badge, .popup.thanks #more { visibility: hidden; }
`

const TEMPLATE = `
  <style>${STYLES}</style>
  <div class="popup yellow" id="popup" role="dialog" aria-label="Tone suggestion">
    <div class="popup-header">
      <div class="tone-badge">
        <span class="tone-dot yellow" id="dot"></span>
        <span class="tone-label" id="label"></span>
        <span class="confidence-text" id="confidence"></span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="more" aria-label="More options" aria-haspopup="menu" aria-expanded="false">⋯</button>
        <button class="icon-btn close" id="close" aria-label="Close">×</button>
      </div>
    </div>
    <div class="more-menu" id="more-menu" role="menu">
      <button role="menuitem" id="edit-context">Edit context about this chat</button>
      <button role="menuitem" id="disable-chat">Don't check this chat</button>
      <button role="menuitem" id="open-settings">Settings</button>
    </div>
    <div class="fine" id="fine" hidden>
      <div class="fine-title">Got it — this message won't be flagged again.</div>
      <div class="fine-text">What was it? Optional, and it stays on this computer.</div>
      <div class="fine-chips" role="group" aria-label="Why it was fine">
        ${FINE_REASONS.map(r => `<button class="fine-chip" data-reason="${r}">${FINE_REASON_LABELS[r]}</button>`).join("")}
      </div>
    </div>
    <div id="main">
    <div class="context-note" id="context-note">💬 Checked with the last few messages in this chat</div>
    <div class="explanation" id="explanation"></div>
    <div class="emoji-notes" id="emoji-notes" aria-label="How the emoji may come across"></div>
    <div class="edits" id="edits" role="list" aria-label="Change just these words"></div>
    <div class="suggestion-box" id="suggestion-box">
      <div class="suggestion-head">
        <div class="suggestion-label">Or rewrite it all:</div>
        <div class="style-row" id="style-row" role="group" aria-label="Suggestion style">
          ${SUGGESTION_STYLES.map(s => `<button class="style-chip" data-style="${s}" aria-pressed="false">${STYLE_LABELS[s]}</button>`).join("")}
        </div>
      </div>
      <div class="suggestion-text" id="suggestion"></div>
      <div class="rewrites" id="rewrites" role="radiogroup" aria-label="Rewrites to choose from"></div>
    </div>
    <div class="actions">
      <button class="btn-accept" id="accept">${ACCEPT_LABEL}</button>
      <button class="btn-dismiss" id="dismiss">It's fine</button>
      <button class="btn-dismiss" id="send-anyway" title="Send anyway (Ctrl+Enter)">Send anyway</button>
    </div>
    <div class="offer" id="offer" role="group" aria-label="Use the chat as context">
      <div id="offer-ask">
        <div class="offer-title">Check with the chat in mind?</div>
        <div class="offer-text">Sentiment Guide can read the last 6 messages in this chat, so it knows what you're replying to — a joke reads differently from an argument. They stay on this computer and are never saved. You can turn this off any time in Settings.</div>
        <div class="offer-actions">
          <button class="offer-yes" id="offer-yes">Turn on</button>
          <button id="offer-no">No thanks</button>
        </div>
      </div>
      <div class="offer-done" id="offer-done" hidden></div>
    </div>
    </div>
  </div>
`

export class SuggestionPopup {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private handlers: PopupHandlers | null = null
  private owner: unknown = null
  private style: SuggestionStyle = "casual"
  /** While "what was it?" is on show: reports the answer (null = none) exactly once */
  private fineDone: ((reason: FineReason | null) => void) | null = null
  private fineTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.host = document.createElement("div")
    this.host.id = "sg-popup-host"
    this.host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;"
    this.root = this.host.attachShadow({ mode: "open" })
    this.root.innerHTML = TEMPLATE

    // Escape inside the card closes it too
    this.root.addEventListener("keydown", e => {
      if ((e as KeyboardEvent).key === "Escape") { e.stopPropagation(); this.handlers?.onClose() }
    })

    const on = (id: string, fn: () => void) =>
      this.$(id).addEventListener("click", (e) => { e.stopPropagation(); fn() })
    on("close",         () => this.handlers?.onClose())
    on("dismiss",       () => this.handlers?.onDismiss())
    on("accept",        () => this.handlers?.onAccept(this.chosen))
    on("more",          () => this.toggleMore())
    on("edit-context",  () => { this.toggleMore(false); this.handlers?.onEditContext() })
    on("disable-chat",  () => { this.toggleMore(false); this.handlers?.onDisableChat() })
    on("open-settings", () => { this.toggleMore(false); this.handlers?.onOpenSettings() })
    on("send-anyway",  () => this.handlers?.onSendAnyway?.())
    on("offer-yes",    () => this.answerOffer(true))
    on("offer-no",     () => this.answerOffer(false))
    this.$("edits").addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>(".btn-apply")
      if (!btn || btn.disabled) return
      e.stopPropagation()
      this.handlers?.onApplyEdit(Number(btn.dataset.index))
    })
    this.root.querySelectorAll<HTMLButtonElement>(".fine-chip").forEach(chip => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation()
        this.finishFine(chip.dataset.reason as FineReason)
        this.hide()
      })
    })
    this.root.querySelectorAll<HTMLButtonElement>(".style-chip").forEach(chip => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation()
        const style = chip.dataset.style as SuggestionStyle
        if (style === this.style) return
        this.setStyle(style)
        this.handlers?.onStyleChange(style)
      })
    })

    document.body.appendChild(this.host)
  }

  private $(id: string): HTMLElement {
    return this.root.getElementById(id)!
  }

  isOpenFor(owner: unknown): boolean {
    return this.owner !== null && this.owner === owner
  }

  /**
   * Show the popup for a flagged message. `advice` is null while the model is
   * still writing the explanation and rewrite — call setAdvice() when it lands.
   */
  show(
    owner: unknown,
    verdict: ToneVerdict,
    advice: ToneAdvice | null,
    style: SuggestionStyle,
    anchor: DOMRect,
    handlers: PopupHandlers,
    options: PopupOptions = {},
  ) {
    const chat  = options.chat ?? { used: false, offer: false }
    this.finishFine(null)
    this.$("fine").hidden = true
    this.$("main").hidden = false
    this.owner    = owner
    this.handlers = handlers
    this.setStyle(style)
    this.toggleMore(false)
    this.$("disable-chat").textContent   = `Don't check this ${options.scope ?? "chat"}`
    this.$("edit-context").style.display = options.canEditContext === false ? "none" : "block"

    const tone = verdict.tone === "red" ? "red" : "yellow"
    this.$("popup").className = "popup " + tone
    this.$("dot").className   = "tone-dot " + tone
    this.$("accept").textContent = ACCEPT_LABEL

    // Confidence indicator — shown only below 0.9
    const conf = this.$("confidence")
    if (verdict.confidence < 0.9) {
      conf.textContent   = verdict.confidence < 0.7 ? "· borderline, your call" : "· fairly confident"
      conf.style.display = "inline"
    } else {
      conf.style.display = "none"
    }

    this.$("send-anyway").style.display  = handlers.onSendAnyway ? "inline-block" : "none"
    this.$("context-note").style.display = chat.used ? "block" : "none"
    this.$("offer").style.display        = chat.offer ? "block" : "none"
    this.$("offer-ask").hidden  = false
    this.$("offer-done").hidden = true

    this.setAdvice(advice)
    this.$("popup").style.display = "block"
    this.position(anchor)
  }

  private toggleMore(open = !this.$("more-menu").classList.contains("open")) {
    this.$("more-menu").classList.toggle("open", open)
    this.$("more").setAttribute("aria-expanded", String(open))
  }

  private setStyle(style: SuggestionStyle) {
    this.style = style
    this.root.querySelectorAll<HTMLElement>(".style-chip").forEach(chip => {
      chip.setAttribute("aria-pressed", String(chip.dataset.style === style))
    })
  }

  /** Fill in the explanation and rewrite, or show the "thinking" state for null. */
  setAdvice(advice: ToneAdvice | null) {
    const red = this.$("popup").classList.contains("red")
    this.$("label").textContent = advice?.label || (red ? "Unkind" : "A little sharp")

    const expl = this.$("explanation")
    expl.textContent = advice ? advice.explanation : "Thinking of a kinder way to say it…"
    expl.classList.toggle("pending", !advice)

    // Always overwrite the suggestion text so a stale one can never be accepted
    const suggestion = advice?.suggestion ?? ""
    const rewrites   = suggestion ? [suggestion, ...(advice?.alternatives ?? [])] : []
    this.renderRewrites(rewrites)
    this.$("suggestion").textContent       = suggestion
    this.$("suggestion").hidden            = rewrites.length > 1
    this.$("suggestion-box").style.display = suggestion ? "block" : "none"
    this.$("accept").style.display         = suggestion ? "inline-block" : "none"
    this.renderEdits(advice?.edits ?? [])
    this.renderEmojiNotes(advice?.emoji_notes ?? [])
  }

  private renderEmojiNotes(notes: ToneAdvice["emoji_notes"]) {
    const list = this.$("emoji-notes")
    list.replaceChildren(...notes.map(note => {
      const row = document.createElement("div")
      row.className = "emoji-note"
      const emoji = document.createElement("span")
      emoji.className = "emoji"
      emoji.textContent = note.emoji
      row.append(emoji, note.reading)
      return row
    }))
    list.style.display = notes.length ? "flex" : "none"
  }

  /** Which rewrite "Use this" takes; the first until another is picked */
  private chosen = 0

  /** 2–3 rewrites as choices (Plan 10.2); one is shown as plain text instead. */
  private renderRewrites(rewrites: string[]) {
    this.chosen = 0
    const list = this.$("rewrites")
    list.hidden = rewrites.length < 2
    list.replaceChildren(...(rewrites.length < 2 ? [] : rewrites.map((text, i) => {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "rewrite-choice"
      b.setAttribute("role", "radio")
      b.setAttribute("aria-checked", String(i === 0))
      b.dataset.index = String(i)
      b.textContent = text
      b.addEventListener("click", () => {
        this.chosen = i
        list.querySelectorAll(".rewrite-choice").forEach(c => c.setAttribute("aria-checked", String(c === b)))
      })
      return b
    })))
  }

  private renderEdits(edits: ToneAdvice["edits"]) {
    const list = this.$("edits")
    list.replaceChildren(...edits.map((edit, i) => {
      const row = document.createElement("div")
      row.className = "edit-row"
      row.setAttribute("role", "listitem")
      const body = document.createElement("div")
      body.className = "edit-body"
      const from = document.createElement("span")
      from.className = "edit-from"
      from.textContent = edit.original
      const arrow = document.createElement("span")
      arrow.className = "edit-arrow"
      arrow.textContent = "→"
      const to = document.createElement("span")
      to.className = edit.replacement ? "edit-to" : "edit-to remove"
      to.textContent = edit.replacement || "remove"
      body.append(from, arrow, to)
      if (edit.reason) {
        const reason = document.createElement("div")
        reason.className = "edit-reason"
        reason.textContent = edit.reason
        body.append(reason)
      }
      const btn = document.createElement("button")
      btn.className = "btn-apply"
      btn.dataset.index = String(i)
      btn.textContent = "Apply"
      btn.setAttribute("aria-label", edit.replacement
        ? `Change "${edit.original}" to "${edit.replacement}"`
        : `Remove "${edit.original}"`)
      row.append(body, btn)
      return row
    }))
    list.style.display = edits.length ? "flex" : "none"
  }

  private answerOffer(on: boolean) {
    this.$("offer-ask").hidden = true
    const done = this.$("offer-done")
    done.hidden = false
    done.textContent = on
      ? "✓ Turned on — checking this message again with the chat in mind."
      : "OK — only your own message is checked. You can turn it on in Settings."
    this.handlers?.onChatContextChoice(on)
  }

  /** Show the outcome of applying one edit in its row. */
  setEditState(index: number, state: EditState) {
    const row = this.$("edits").children[index]
    const btn = row?.querySelector<HTMLButtonElement>(".btn-apply")
    if (!row || !btn) return
    row.classList.add("done")
    btn.disabled = true
    btn.textContent = EDIT_STATE_LABELS[state]
  }

  /**
   * After "It's fine": the card turns into a one-line question, "what was
   * it?", with a chip per reason. `done` gets the reason picked, or null when
   * the card closes without one (×, typing, a new flag, or after 8 s).
   */
  askWhyFine(done: (reason: FineReason | null) => void) {
    this.finishFine(null)
    this.fineDone = done
    this.toggleMore(false)
    this.$("main").hidden = true
    this.$("fine").hidden = false
    this.$("popup").classList.add("thanks")
    // Focus stays in the message box: typing on simply closes the question
    this.fineTimer = setTimeout(() => { this.finishFine(null); this.hide() }, FINE_ASK_MS)
  }

  private finishFine(reason: FineReason | null) {
    clearTimeout(this.fineTimer)
    const done = this.fineDone
    this.fineDone = null
    done?.(reason)
  }

  hide() {
    this.finishFine(null)
    this.owner    = null
    this.handlers = null
    this.$("popup").style.display = "none"
    this.$("popup").classList.remove("thanks")
  }

  /** Temporarily relabel the accept button (e.g. "✓ Replaced!"). */
  setAcceptLabel(text: string) {
    this.$("accept").textContent = text
  }

  /**
   * Place the popup above `anchor`, with the caret pointing at its centre —
   * or below it, when the words are near the top of the window (a comment
   * box at the top of a page) and there's more room underneath.
   */
  position(anchor: DOMRect) {
    const popup     = this.$("popup")
    const anchorX   = anchor.left + anchor.width / 2
    const width     = popup.getBoundingClientRect().width || 300
    const left      = Math.max(8, Math.min(anchorX - width / 2, window.innerWidth - width - 8))
    const caretLeft = Math.max(20, Math.min(anchorX - left, width - 20))
    const below     = anchor.top < CARD_HEIGHT && window.innerHeight - anchor.bottom > anchor.top

    popup.style.setProperty("--caret-left", caretLeft + "px")
    popup.classList.toggle("below", below)
    popup.style.left   = left + "px"
    popup.style.bottom = below ? "auto" : window.innerHeight - anchor.top + 12 + "px"
    popup.style.top    = below ? anchor.bottom + 12 + "px" : "auto"
  }

  destroy() {
    this.host.remove()
  }
}
