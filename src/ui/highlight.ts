// =============================================================================
// Word-level highlight
// Draws overlay divs at the phrase's exact screen position (box-text.ts
// measures it, for rich editors and plain textareas alike).
// pointer-events:none so clicks pass through to the page. Redraws on scroll,
// resize and typing; drops itself when the phrase leaves the box.
// =============================================================================

import type { Tone } from "../analysis/types"
import { phraseRects } from "./box-text"

const COLORS: Record<Exclude<Tone, "green">, { line: string; fill: string }> = {
  yellow: { line: "#F59E0B", fill: "rgba(245,158,11,0.12)" },
  red:    { line: "#DC2626", fill: "rgba(220,38,38,0.10)" },
}

export class Highlighter {
  private current: { phrase: string; tone: Exclude<Tone, "green"> } | null = null
  private divs: HTMLElement[] = []
  private frame = 0
  private readonly onViewportChange = () => this.refresh()

  constructor(private readonly box: HTMLElement) {}

  show(phrase: string, tone: Tone) {
    this.clear()
    if (!phrase || tone === "green") return
    this.current = { phrase, tone }
    window.addEventListener("scroll", this.onViewportChange, true)
    window.addEventListener("resize", this.onViewportChange)
    this.draw()
  }

  clear() {
    this.current = null
    cancelAnimationFrame(this.frame)
    window.removeEventListener("scroll", this.onViewportChange, true)
    window.removeEventListener("resize", this.onViewportChange)
    this.removeDivs()
  }

  /** Whether a point (client coordinates) is on the highlighted phrase. */
  hitTest(x: number, y: number): boolean {
    return this.divs.some(d => {
      const r = d.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top - 2 && y <= r.bottom + 2
    })
  }

  /** Redraw at the phrase's current position on the next frame. */
  refresh() {
    if (!this.current) return
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => {
      if (!this.current) return
      if (!this.draw()) this.clear()
    })
  }

  private removeDivs() {
    this.divs.forEach(d => d.remove())
    this.divs = []
  }

  /** Returns false when the phrase is no longer in the box. */
  private draw(): boolean {
    this.removeDivs()
    if (!this.current) return false
    const rects = phraseRects(this.box, this.current.phrase)
    if (!rects) return false

    const { line, fill } = COLORS[this.current.tone]
    for (const rect of rects) {
      if (rect.width < 2) continue
      const div = document.createElement("div")
      div.className = "sg-highlight"
      div.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: ${fill};
        border-bottom: 2px solid ${line};
        border-radius: 2px;
        pointer-events: none;
        z-index: 9998;
      `
      document.body.appendChild(div)
      this.divs.push(div)
    }
    return true
  }
}
