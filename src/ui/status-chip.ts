// =============================================================================
// Status chip — a small pill above the compose box that says when messages
// aren't being checked: the AI is offline or loading, the extension is
// paused, or checking is off for this chat. Without it, "not checked" looks
// exactly like "your message is fine".
// =============================================================================

export type ChipState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "no-model" }
  | { kind: "slow" }
  | { kind: "paused"; until: number }
  | { kind: "chat-off"; onTurnOn: () => void }

const TEXT: Record<Exclude<ChipState["kind"], "hidden" | "paused" | "chat-off">, { text: string; title: string; tone: "info" | "warn" }> = {
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
  .chip.quiet { background: #f3f4f6; color: #4b5563; border: 1px solid #e5e7eb; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .info .dot { animation: pulse 1.2s ease-in-out infinite; }
  .action {
    display: none; background: none; border: none; padding: 0; margin-left: 2px;
    font: inherit; font-weight: 600; color: #4f46e5; text-decoration: underline; cursor: pointer;
  }
  .action.visible { display: inline; }
  @keyframes pulse { 50% { opacity: 0.3; } }
`

export class StatusChip {
  private readonly host: HTMLElement
  private readonly chip: HTMLElement
  private readonly label: HTMLElement
  private readonly action: HTMLButtonElement
  private anchor: HTMLElement | null = null
  private state: ChipState = { kind: "hidden" }
  private readonly reposition = () => this.place()

  constructor() {
    this.host = document.createElement("div")
    this.host.id = "sg-status-host"
    this.host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;"
    const root = this.host.attachShadow({ mode: "open" })
    root.innerHTML = `<style>${STYLES}</style><div class="chip" role="status" aria-live="polite"><span class="dot"></span><span class="label"></span><button class="action"></button></div>`
    this.chip   = root.querySelector(".chip")!
    this.label  = root.querySelector(".label")!
    this.action = root.querySelector(".action")!
    this.action.addEventListener("click", (e) => {
      e.stopPropagation()
      if (this.state.kind === "chat-off") this.state.onTurnOn()
    })
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
    let text: string, title: string, tone: "info" | "warn" | "quiet"
    let actionLabel = ""
    if (state.kind === "paused") {
      text  = `Sentiment Guide paused until ${formatUntil(state.until)}`
      title = "Resume from the toolbar button"
      tone  = "quiet"
    } else if (state.kind === "chat-off") {
      text  = "Not checking this chat ·"
      title = "You turned Sentiment Guide off for this chat"
      tone  = "quiet"
      actionLabel = "Turn on"
    } else {
      ({ text, title, tone } = TEXT[state.kind])
    }
    this.label.textContent  = text
    this.chip.title         = title
    this.chip.className     = `chip visible ${tone}`
    this.action.textContent = actionLabel
    this.action.classList.toggle("visible", !!actionLabel)
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

  hide() {
    this.set({ kind: "hidden" })
  }

  destroy() {
    window.removeEventListener("resize", this.reposition)
    this.host.remove()
  }
}

function formatUntil(until: number): string {
  const d    = new Date(until)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return d.toDateString() === new Date().toDateString() ? time : `tomorrow ${time}`
}
