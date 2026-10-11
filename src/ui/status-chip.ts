// =============================================================================
// Status chip — a small pill above the compose box that says when the AI
// can't check messages ("AI offline") or is still loading. Without it a
// failure looks exactly like "your message is fine".
// =============================================================================

export type ChipState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "no-model" }
  | { kind: "slow" }
  | { kind: "paused"; until: number | null }

const TEXT: Record<Exclude<ChipState["kind"], "hidden" | "paused">, { text: string; title: string; tone: "info" | "warn" }> = {
  loading:    { text: "Sentiment Guide: loading the AI…", title: "The first check after starting can take a minute.", tone: "info" },
  offline:    { text: "Sentiment Guide: AI offline",      title: "Ollama isn't running. Start it with: ollama serve", tone: "warn" },
  "no-model": { text: "Sentiment Guide: model missing",   title: "Install the model with: ollama pull gemma3:4b",     tone: "warn" },
  slow:       { text: "Sentiment Guide: AI is slow",      title: "The last check took too long and was skipped.",     tone: "warn" },
}

const STYLES = `
  .chip {
    position: fixed;
    display: none;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 99px;
    font: 500 11px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    pointer-events: auto;
    cursor: default;
    z-index: 2147483647;
  }
  .chip.visible { display: inline-flex; }
  .chip.info { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }
  .chip.warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .info .dot { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
`

export class StatusChip {
  private readonly host: HTMLElement
  private readonly chip: HTMLElement
  private readonly label: HTMLElement
  private anchor: HTMLElement | null = null
  private state: ChipState = { kind: "hidden" }
  private readonly reposition = () => this.place()

  constructor() {
    this.host = document.createElement("div")
    this.host.id = "sg-status-host"
    this.host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;"
    const root = this.host.attachShadow({ mode: "open" })
    root.innerHTML = `<style>${STYLES}</style><div class="chip" role="status" aria-live="polite"><span class="dot"></span><span class="label"></span></div>`
    this.chip  = root.querySelector(".chip")!
    this.label = root.querySelector(".label")!
    document.body.appendChild(this.host)
    window.addEventListener("resize", this.reposition)
  }

  get kind() {
    return this.state.kind
  }

  /** The compose box the chip sits above. */
  setAnchor(box: HTMLElement | null) {
    this.anchor = box
    this.place()
  }

  set(state: ChipState) {
    this.state = state
    if (state.kind === "hidden") {
      this.chip.classList.remove("visible")
      return
    }
    let text: string, title: string, tone: "info" | "warn"
    if (state.kind === "paused") {
      text  = state.until
        ? `Sentiment Guide paused until ${new Date(state.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Sentiment Guide is off"
      title = "Turn it back on from the toolbar button"
      tone  = "info"
    } else {
      ({ text, title, tone } = TEXT[state.kind])
    }
    this.label.textContent = text
    this.chip.title        = title
    this.chip.className    = `chip visible ${tone}`
    if (state.kind === "paused") this.chip.querySelector(".dot")!.setAttribute("style", "animation:none")
    else this.chip.querySelector(".dot")!.removeAttribute("style")
    this.place()
  }

  private place() {
    // Only show while there is a compose box to sit above
    const anchored = !!this.anchor && document.contains(this.anchor)
    this.chip.style.visibility = anchored ? "visible" : "hidden"
    if (!anchored || this.state.kind === "hidden") return
    const r = this.anchor!.getBoundingClientRect()
    this.chip.style.right  = Math.max(8, window.innerWidth - r.right) + "px"
    this.chip.style.bottom = window.innerHeight - r.top + 6 + "px"
  }

  destroy() {
    window.removeEventListener("resize", this.reposition)
    this.host.remove()
  }
}
