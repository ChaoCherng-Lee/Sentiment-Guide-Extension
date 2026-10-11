// =============================================================================
// Suggestion popup — Grammarly-style card shown above the flagged phrase.
// One instance per page, shared by every compose box; `owner` records which
// compose session it is currently showing for.
// Lives in a Shadow DOM host so styles never leak into the page.
// =============================================================================

import type { ToneResult } from "../analysis/types"

export interface PopupHandlers {
  onAccept(): void
  onDismiss(): void
  onEditContext(): void
}

const ACCEPT_LABEL = "Accept (Tab)"

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .popup {
    background: white;
    border-radius: 12px;
    padding: 14px 16px;
    min-width: 280px;
    max-width: 340px;
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

  .close-btn {
    background: none; border: none; cursor: pointer;
    color: #aaa; font-size: 18px; padding: 0;
    line-height: 1; flex-shrink: 0; font-family: inherit;
  }
  .close-btn:hover { color: #555; }

  .confidence-text {
    font-size: 11px; color: #9ca3af; font-style: italic;
    margin-bottom: 8px; display: none;
  }

  .explanation { font-size: 12px; color: #555; margin-bottom: 10px; line-height: 1.6; }

  .suggestion-box { background: #f7f7f7; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
  .suggestion-label { font-size: 11px; font-weight: 500; color: #888; margin-bottom: 4px; }
  .suggestion-text { font-size: 12px; font-style: italic; color: #333; line-height: 1.5; }

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

  .edit-context-btn {
    background: none; border: none;
    font-size: 11px; color: #a78bfa;
    cursor: pointer; margin-left: auto;
    font-family: inherit; padding: 0;
    text-decoration: underline;
  }
  .edit-context-btn:hover { color: #7c3aed; }
`

const TEMPLATE = `
  <style>${STYLES}</style>
  <div class="popup yellow" id="popup" role="dialog" aria-label="Tone suggestion">
    <div class="popup-header">
      <div class="tone-badge">
        <span class="tone-dot yellow" id="dot"></span>
        <span class="tone-label" id="label"></span>
      </div>
      <button class="close-btn" id="close" aria-label="Close">×</button>
    </div>
    <div class="confidence-text" id="confidence"></div>
    <div class="explanation" id="explanation"></div>
    <div class="suggestion-box" id="suggestion-box">
      <div class="suggestion-label">Try:</div>
      <div class="suggestion-text" id="suggestion"></div>
    </div>
    <div class="actions">
      <button class="btn-accept" id="accept">${ACCEPT_LABEL}</button>
      <button class="btn-dismiss" id="dismiss">Dismiss</button>
      <button class="edit-context-btn" id="edit-context">Edit context</button>
    </div>
  </div>
`

export class SuggestionPopup {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private handlers: PopupHandlers | null = null
  private owner: unknown = null

  constructor() {
    this.host = document.createElement("div")
    this.host.id = "sg-popup-host"
    this.host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;"
    this.root = this.host.attachShadow({ mode: "open" })
    this.root.innerHTML = TEMPLATE

    const on = (id: string, fn: () => void) =>
      this.$(id).addEventListener("click", (e) => { e.stopPropagation(); fn() })
    on("close",        () => this.handlers?.onDismiss())
    on("dismiss",      () => this.handlers?.onDismiss())
    on("accept",       () => this.handlers?.onAccept())
    on("edit-context", () => this.handlers?.onEditContext())

    document.body.appendChild(this.host)
  }

  private $(id: string): HTMLElement {
    return this.root.getElementById(id)!
  }

  isOpenFor(owner: unknown): boolean {
    return this.owner !== null && this.owner === owner
  }

  show(owner: unknown, result: ToneResult, anchor: DOMRect, handlers: PopupHandlers) {
    this.owner    = owner
    this.handlers = handlers

    const tone = result.tone === "red" ? "red" : "yellow"
    this.$("popup").className = "popup " + tone
    this.$("dot").className   = "tone-dot " + tone
    this.$("label").textContent       = result.label || (tone === "red" ? "Unkind" : "A little sharp")
    this.$("explanation").textContent = result.explanation || ""
    this.$("accept").textContent      = ACCEPT_LABEL

    // Confidence indicator — shown only below 0.9
    const conf = this.$("confidence")
    if (result.confidence < 0.9) {
      conf.textContent   = result.confidence < 0.7 ? "borderline — your call" : "fairly confident"
      conf.style.display = "block"
    } else {
      conf.style.display = "none"
    }

    // Always overwrite the suggestion text so a stale one can never be accepted
    this.$("suggestion").textContent           = result.suggestion
    this.$("suggestion-box").style.display     = result.suggestion ? "block" : "none"
    this.$("accept").style.display             = result.suggestion ? "inline-block" : "none"

    this.$("popup").style.display = "block"
    this.position(anchor)
  }

  hide() {
    this.owner    = null
    this.handlers = null
    this.$("popup").style.display = "none"
  }

  /** Temporarily relabel the accept button (e.g. "✓ Replaced!"). */
  setAcceptLabel(text: string) {
    this.$("accept").textContent = text
  }

  /** Place the popup above `anchor`, with the caret pointing at its centre. */
  position(anchor: DOMRect) {
    const popup        = this.$("popup")
    const anchorBottom = window.innerHeight - anchor.top + 12
    const anchorX      = anchor.left + anchor.width / 2
    const width        = popup.getBoundingClientRect().width || 300
    const left         = Math.max(8, Math.min(anchorX - width / 2, window.innerWidth - width - 8))
    const caretLeft    = Math.max(20, Math.min(anchorX - left, width - 20))

    popup.style.setProperty("--caret-left", caretLeft + "px")
    popup.style.left   = left + "px"
    popup.style.bottom = anchorBottom + "px"
    popup.style.top    = "auto"
  }

  destroy() {
    this.host.remove()
  }
}
