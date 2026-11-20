// =============================================================================
// Status badge — a small round button in the corner of each compose box, like
// Grammarly's. It always says what Sentiment Guide is doing with the message:
// checking, fine, flagged, or not checking (and why). Without it, "not
// checked" looks exactly like "your message is fine".
//
// Two inputs decide what it shows:
// - page state, from the engine: AI loading / offline / slow, paused, off for
//   this chat — the same for every box on the page
// - box state, from the compose session: idle, checking, fine, flagged
// A page problem wins over the box state.
// =============================================================================

import type { Tone } from "../analysis/types"

export type PageState =
  | { kind: "ok" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "no-model" }
  | { kind: "slow" }
  /** The cloud check's hourly limit was reached */
  | { kind: "limit" }
  | { kind: "paused"; until: number }
  | { kind: "chat-off" }

export type BoxState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "fine" }
  | { kind: "flagged"; tone: Exclude<Tone, "green"> }

/** What the badge's buttons do. Supplied by the engine (page actions) and the session (open the card). */
export interface BadgeActions {
  /** Open the suggestion card for the flagged message. */
  openCard(): void
  /** Open the setup page (AI offline or model missing). */
  openSetup(): void
  openSettings(): void
  pauseHour(): void
  resume(): void
  /** Turn checking off (false) or back on (true) for this chat or site. */
  setChatChecking(on: boolean): void
  /** "chat" on messaging sites, "site" where the whole site is the unit (other websites). */
  scope: "chat" | "site"
  /**
   * Show only while the box is in use (focused) or flagged. For pages full
   * of text boxes, where a badge on every one would be noise.
   */
  quietWhenIdle?: boolean
}

/** Shown state: the page problem if there is one, else the box state. */
type Shown = Exclude<PageState, { kind: "ok" }> | BoxState

const SIZE = 22
const INSET = 5

function describe(s: Shown, scope: "chat" | "site"): string {
  switch (s.kind) {
    case "idle":     return "Sentiment Guide is on"
    case "checking": return "Checking your message…"
    case "fine":     return "Sounds fine"
    case "flagged":  return s.tone === "red" ? "This could hurt — click to see why" : "Might come across badly — click to see why"
    case "loading":  return "Loading the AI — the first check can take a minute"
    case "offline":  return "The AI isn't running — click to set it up"
    case "no-model": return "The AI model isn't installed — click to set it up"
    case "slow":     return "The AI is slow — the last check was skipped"
    case "limit":    return "You've reached this hour's limit for cloud checks — they start again within the hour"
    case "paused":   return `Paused until ${formatUntil(s.until)}`
    case "chat-off": return `Not checking this ${scope}`
  }
}

const ICONS = {
  diamond: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" fill="currentColor"/></svg>`,
  check:   `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5 6.8 11 12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  alert:   `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="12" r="1.2" fill="currentColor"/></svg>`,
  pause:   `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4.5v7M10 4.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  off:     `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 11.2 11.2 4.8" stroke="currentColor" stroke-width="1.6"/></svg>`,
  spinner: `<span class="spin" aria-hidden="true"></span>`,
}

function icon(s: Shown): string {
  switch (s.kind) {
    case "idle":     return ICONS.diamond
    case "checking":
    case "loading":  return ICONS.spinner
    case "fine":     return ICONS.check
    case "flagged":
    case "offline":
    case "no-model":
    case "slow":
    case "limit":    return ICONS.alert
    case "paused":   return ICONS.pause
    case "chat-off": return ICONS.off
  }
}

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .badge {
    position: fixed; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
    display: none; align-items: center; justify-content: center;
    border: 1px solid #e0e7ff; background: white; color: #4f46e5;
    box-shadow: 0 1px 4px rgba(15,23,42,0.18);
    cursor: pointer; pointer-events: auto; z-index: 2147483646;
    transition: transform 0.12s, opacity 0.12s;
    font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .badge.visible { display: flex; }
  .badge:hover { transform: scale(1.12); }
  .badge:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
  .badge svg { width: 14px; height: 14px; }
  .badge[data-state="idle"]     { opacity: 0.75; }
  .badge[data-state="fine"]     { background: #10b981; border-color: #10b981; color: white; }
  .badge[data-state="flagged"][data-tone="yellow"] { background: #F59E0B; border-color: #F59E0B; color: white; }
  .badge[data-state="flagged"][data-tone="red"]    { background: #DC2626; border-color: #DC2626; color: white; }
  .badge[data-state="offline"], .badge[data-state="no-model"], .badge[data-state="slow"], .badge[data-state="limit"] {
    background: #fffbeb; border-color: #f59e0b; color: #b45309;
  }
  .badge[data-state="paused"], .badge[data-state="chat-off"] { background: #f3f4f6; border-color: #d1d5db; color: #6b7280; }
  .spin {
    width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid #c7d2fe; border-top-color: #4f46e5; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }

  .menu {
    position: fixed; display: none; min-width: 200px; max-width: 260px;
    background: white; border: 1px solid #e5e7eb; border-radius: 10px;
    box-shadow: 0 6px 24px rgba(15,23,42,0.16); padding: 6px; z-index: 2147483647;
    pointer-events: auto;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827;
  }
  .menu.open { display: block; }
  .menu .title { padding: 6px 8px 8px; font-weight: 600; font-size: 12px; color: #374151; border-bottom: 1px solid #f3f4f6; margin-bottom: 4px; }
  .menu button {
    display: block; width: 100%; text-align: left; padding: 6px 8px; border-radius: 6px;
    border: none; background: none; font: inherit; color: #111827; cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible { background: #f3f4f6; outline: none; }
  .live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`

export class StatusBadge {
  private readonly host: HTMLElement
  private readonly badge: HTMLButtonElement
  private readonly menu: HTMLElement
  private readonly live: HTMLElement
  private page: PageState = { kind: "ok" }
  private box: BoxState = { kind: "idle" }
  private hidden = false
  private readonly cleanups: (() => void)[] = []
  private readonly reposition = () => this.place()

  constructor(private readonly target: HTMLElement, private readonly actions: BadgeActions) {
    this.host = document.createElement("div")
    this.host.className = "sg-badge-host"
    this.host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;"
    const root = this.host.attachShadow({ mode: "open" })
    root.innerHTML = `<style>${STYLES}</style>
      <button class="badge" type="button"></button>
      <div class="menu" role="menu"></div>
      <div class="live" aria-live="polite"></div>`
    this.badge = root.querySelector(".badge")!
    this.menu  = root.querySelector(".menu")!
    this.live  = root.querySelector(".live")!
    document.body.appendChild(this.host)

    // Keep focus in the compose box: a mouse click on the badge or its menu shouldn't take the caret away
    this.badge.addEventListener("mousedown", e => e.preventDefault())
    this.menu.addEventListener("mousedown", e => e.preventDefault())
    this.badge.addEventListener("click", e => { e.stopPropagation(); this.onClick() })
    this.menu.addEventListener("click", e => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button[data-action]")
      if (!btn) return
      e.stopPropagation()
      this.closeMenu()
      this.run(btn.dataset.action!)
    })
    const closeOnOutside = (e: MouseEvent) => {
      if (!e.composedPath().includes(this.host)) this.closeMenu()
    }
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === "Escape") this.closeMenu() }
    document.addEventListener("mousedown", closeOnOutside, true)
    document.addEventListener("keydown", closeOnEscape, true)

    // The box moves and grows with the page; follow it
    window.addEventListener("scroll", this.reposition, true)
    window.addEventListener("resize", this.reposition)
    target.addEventListener("focus", this.reposition)
    target.addEventListener("blur", this.reposition)
    const ro = new ResizeObserver(this.reposition)
    ro.observe(target)
    const timer = setInterval(this.reposition, 1000)
    this.cleanups.push(
      () => document.removeEventListener("mousedown", closeOnOutside, true),
      () => document.removeEventListener("keydown", closeOnEscape, true),
      () => window.removeEventListener("scroll", this.reposition, true),
      () => window.removeEventListener("resize", this.reposition),
      () => target.removeEventListener("focus", this.reposition),
      () => target.removeEventListener("blur", this.reposition),
      () => ro.disconnect(),
      () => clearInterval(timer),
    )
    this.render()
  }

  /** What the badge shows right now: "checking", "fine", "flagged", "paused", … */
  get state(): Shown["kind"] {
    return this.shown().kind
  }

  /** The compose box's own state, whatever the page state. */
  get boxKind(): BoxState["kind"] {
    return this.box.kind
  }

  setPage(state: PageState) {
    this.page = state
    this.render()
  }

  setBox(state: BoxState) {
    const wasFlagged = this.box.kind === "flagged"
    this.box = state
    this.render()
    // Screen readers hear about a flag once, not every state change
    if (state.kind === "flagged" && !wasFlagged) this.live.textContent = describe(state, this.actions.scope)
    if (state.kind !== "flagged") this.live.textContent = ""
  }

  /** Hide completely — the extension is switched off. */
  setHidden(hidden: boolean) {
    this.hidden = hidden
    if (hidden) this.closeMenu()
    this.place()
  }

  private shown(): Shown {
    return this.page.kind === "ok" ? this.box : this.page
  }

  private render() {
    const s = this.shown()
    const text = describe(s, this.actions.scope)
    this.badge.dataset.state = s.kind
    if (s.kind === "flagged") this.badge.dataset.tone = s.tone
    else delete this.badge.dataset.tone
    this.badge.innerHTML = icon(s)
    this.badge.title = text
    this.badge.setAttribute("aria-label", "Sentiment Guide: " + text)
    if (this.menu.classList.contains("open")) this.openMenu()   // refresh its contents
    this.place()
  }

  private onClick() {
    const s = this.shown()
    if (s.kind === "flagged") return this.actions.openCard()
    if (s.kind === "offline" || s.kind === "no-model") return this.actions.openSetup()
    if (this.menu.classList.contains("open")) this.closeMenu()
    else this.openMenu()
  }

  private openMenu() {
    const s = this.shown()
    const scope = this.actions.scope
    const items: [string, string][] = []
    if (s.kind === "paused") items.push(["resume", "Resume now"])
    else if (s.kind === "chat-off") items.push(["chat-on", `Turn on for this ${scope}`])
    else {
      items.push(["pause", "Pause for 1 hour"])
      items.push(["chat-off", `Don't check this ${scope}`])
    }
    if (s.kind === "slow") items.push(["setup", "Check the AI setup"])
    items.push(["settings", "Settings"])

    const title = document.createElement("div")
    title.className = "title"
    title.textContent = describe(s, scope)
    this.menu.replaceChildren(title, ...items.map(([action, label]) => {
      const b = document.createElement("button")
      b.type = "button"
      b.setAttribute("role", "menuitem")
      b.dataset.action = action
      b.textContent = label
      return b
    }))
    this.menu.classList.add("open")
    this.place()
  }

  private closeMenu() {
    this.menu.classList.remove("open")
  }

  private run(action: string) {
    const a = this.actions
    switch (action) {
      case "resume":   return a.resume()
      case "pause":    return a.pauseHour()
      case "chat-on":  return a.setChatChecking(true)
      case "chat-off": return a.setChatChecking(false)
      case "setup":    return a.openSetup()
      case "settings": return a.openSettings()
    }
  }

  /**
   * Sit in the bottom-right corner, inside the box (centred vertically in a
   * one-line box). Only while the box is on screen; on pages where text boxes
   * are everywhere, only while it's in use or flagged.
   */
  private place() {
    const r = this.target.getBoundingClientRect()
    const onScreen = document.contains(this.target) && r.width > 40 && r.height > 12
      && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
    const inUse = !this.actions.quietWhenIdle || this.box.kind === "flagged"
      || this.target === document.activeElement || this.target.contains(document.activeElement)
      || this.menu.classList.contains("open")
    const visible = !this.hidden && onScreen && inUse
    this.badge.classList.toggle("visible", visible)
    if (!visible) { this.closeMenu(); return }

    const top  = r.height < SIZE + 2 * INSET + 8 ? r.top + (r.height - SIZE) / 2 : r.bottom - SIZE - INSET
    const left = r.right - SIZE - INSET
    this.badge.style.top  = Math.round(top) + "px"
    this.badge.style.left = Math.round(left) + "px"

    if (this.menu.classList.contains("open")) {
      const m = this.menu.getBoundingClientRect()
      const above = top - m.height - 6
      this.menu.style.top  = Math.round(above > 8 ? above : top + SIZE + 6) + "px"
      this.menu.style.left = Math.round(Math.max(8, Math.min(left + SIZE - m.width, window.innerWidth - m.width - 8))) + "px"
    }
  }

  dispose() {
    this.cleanups.forEach(fn => fn())
    this.host.remove()
  }
}

function formatUntil(until: number): string {
  const d    = new Date(until)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return d.toDateString() === new Date().toDateString() ? time : `tomorrow ${time}`
}
