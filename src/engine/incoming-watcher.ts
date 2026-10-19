// =============================================================================
// IncomingWatcher — opt-in reading of received messages (Plan 3.1).
// Asks the adapter for new incoming bubbles, gets a low-priority reading for
// each from the background worker, and badges the ones worth a second look.
// Readings are cached per message for this page session only — never stored.
// =============================================================================

import { worthABadge } from "../analysis/incoming"
import type { IncomingAnalysis } from "../analysis/types"
import { sendMessage } from "../messaging"
import type { IncomingMessage, PlatformAdapter } from "../platforms/types"
import { recordIncomingFeedback } from "../settings/store"
import { IncomingBadge } from "../ui/incoming-badge"

export class IncomingWatcher {
  private stopObserving: (() => void) | null = null
  private readonly cache  = new Map<string, IncomingAnalysis | "pending">()
  private readonly badges = new Map<HTMLElement, IncomingBadge>()

  constructor(private readonly adapter: PlatformAdapter) {}

  get enabled() {
    return this.stopObserving !== null
  }

  setEnabled(on: boolean) {
    if (on && !this.stopObserving) {
      this.stopObserving = this.adapter.observeIncoming(msg => this.handle(msg))
    } else if (!on && this.stopObserving) {
      this.stopObserving()
      this.stopObserving = null
      this.badges.forEach(b => b.remove())
      this.badges.clear()
    }
  }

  private async handle(msg: IncomingMessage) {
    const cached = this.cache.get(msg.key)
    if (cached === "pending") return
    if (cached) { this.render(msg, cached); return }

    this.cache.set(msg.key, "pending")
    const res = await sendMessage({ type: "READ_INCOMING", text: msg.text, key: msg.key })
    if (!res?.ok) {
      // Not read (off, paused, model offline) — try again next time it's seen
      this.cache.delete(msg.key)
      return
    }
    this.cache.set(msg.key, res.analysis)
    if (this.enabled) this.render(msg, res.analysis)
  }

  private render(msg: IncomingMessage, analysis: IncomingAnalysis) {
    if (!worthABadge(analysis.reading) || !msg.element.isConnected) return
    const old = this.badges.get(msg.element)
    if (old?.attached) return
    // Forget badges whose bubbles WhatsApp has thrown away
    for (const [el, b] of this.badges) if (!b.attached) this.badges.delete(el)
    const badge = new IncomingBadge(msg.element, analysis, helpful => recordIncomingFeedback(analysis.reading, helpful))
    this.badges.set(msg.element, badge)
  }
}
