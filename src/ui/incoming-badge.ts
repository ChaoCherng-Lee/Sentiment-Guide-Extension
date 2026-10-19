// =============================================================================
// Incoming badge — a small dot on a received message that says how it
// probably reads, with the explanation in a tooltip on hover or focus.
// Shown only for readings worth a second look (not friendly / neutral).
// Shadow DOM, so styles never leak into the page.
// =============================================================================

import type { IncomingAnalysis, IncomingReading } from "../analysis/types"

const LABELS: Record<IncomingReading, string> = {
  friendly:  "Probably friendly",
  neutral:   "Probably neutral",
  teasing:   "Probably teasing",
  sarcastic: "Might be sarcastic",
  upset:     "They might be upset",
  angry:     "They might be angry",
  unclear:   "Hard to tell",
}

const STYLES = `
  :host { all: initial; display: inline-block; vertical-align: middle; margin-left: 6px; }
  .dot {
    width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; padding: 0;
    cursor: help; box-shadow: 0 0 0 1px rgba(0,0,0,0.15); display: block;
  }
  .dot:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
  .teasing   { background: #3b82f6; }
  .sarcastic { background: #8b5cf6; }
  .upset     { background: #f59e0b; }
  .angry     { background: #dc2626; }
  .unclear, .friendly, .neutral { background: #9ca3af; }

  .tip {
    position: fixed; z-index: 2147483647; display: none; width: 240px;
    background: white; color: #111827; border: 1px solid #e5e7eb; border-radius: 10px;
    box-shadow: 0 4px 18px rgba(0,0,0,0.15); padding: 10px 12px;
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .tip.open { display: block; }
  .title { font-weight: 600; margin-bottom: 2px; }
  .expl { color: #4b5563; }
  .who { font-size: 10px; color: #9ca3af; margin-top: 6px; }
  .fb { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 11px; color: #6b7280; }
  .fb button {
    border: 1px solid #e5e7eb; background: #f9fafb; border-radius: 6px; padding: 0 6px;
    cursor: pointer; font-size: 12px; line-height: 1.6;
  }
  .fb button:hover { background: #f3f4f6; }
`

export class IncomingBadge {
  readonly host: HTMLElement
  private readonly root: ShadowRoot

  constructor(
    readonly bubble: HTMLElement,
    analysis: IncomingAnalysis,
    onFeedback: (helpful: boolean) => void,
  ) {
    this.host = document.createElement("span")
    this.host.className = "sg-incoming-badge"
    this.root = this.host.attachShadow({ mode: "open" })

    const label = LABELS[analysis.reading]
    this.root.innerHTML = `
      <style>${STYLES}</style>
      <button class="dot ${analysis.reading}" aria-describedby="tip"></button>
      <div class="tip" id="tip" role="tooltip">
        <div class="title"></div>
        <div class="expl"></div>
        <div class="fb" id="fb">Was this helpful?
          <button data-helpful="1" aria-label="Helpful">👍</button>
          <button data-helpful="0" aria-label="Not helpful">👎</button>
        </div>
        <div class="who">Sentiment Guide · a guess, not a fact</div>
      </div>`
    const dot = this.root.querySelector<HTMLButtonElement>(".dot")!
    dot.setAttribute("aria-label", `Sentiment Guide: ${label.toLowerCase()}. Show why`)
    this.root.querySelector(".title")!.textContent = label
    this.root.querySelector(".expl")!.textContent  = analysis.explanation

    const tip  = this.root.querySelector<HTMLElement>(".tip")!
    const open = () => {
      const r = dot.getBoundingClientRect()
      tip.classList.add("open")
      const h = tip.offsetHeight
      tip.style.left = Math.max(8, Math.min(r.left - 8, window.innerWidth - 248)) + "px"
      tip.style.top  = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + "px"
    }
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const close = () => { closeTimer = setTimeout(() => tip.classList.remove("open"), 150) }
    const keep  = () => clearTimeout(closeTimer)
    for (const el of [dot, tip]) {
      el.addEventListener("mouseenter", () => { keep(); open() })
      el.addEventListener("mouseleave", close)
    }
    this.host.addEventListener("focusin", () => { keep(); open() })
    this.host.addEventListener("focusout", close)
    dot.addEventListener("keydown", e => { if (e.key === "Escape") tip.classList.remove("open") })

    this.root.getElementById("fb")!.addEventListener("click", e => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button")
      if (!btn) return
      e.stopPropagation()
      onFeedback(btn.dataset.helpful === "1")
      this.root.getElementById("fb")!.textContent = "Thanks — that helps make it better."
    })

    // After the text, next to it, so it reads as part of the message
    const anchor = bubble.querySelector("[data-pre-plain-text]") ?? bubble
    anchor.appendChild(this.host)
  }

  get attached(): boolean {
    return this.host.isConnected
  }

  remove() {
    this.host.remove()
  }
}
