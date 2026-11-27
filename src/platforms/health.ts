// Adapter health (Plan 12.2, Spec NFR-6).
//
// Sites change their pages. If a site adapter (WhatsApp, Instagram, Gmail)
// finds no message box where there should be one (a chat is open), yet the
// person writes a sentence in a box on that page, the adapter has probably
// broken. Then that box is checked with the generic adapter instead, and
// `onBroken` is called (the engine rescans and, once per page and with
// diagnostics on, reports "adapter X broken").

import type { PlatformAdapter } from "./types"

/** Written this much in a box the adapter missed = it should have found it */
const BROKEN_AFTER_CHARS = 20

function editableRoot(el: EventTarget | null): HTMLElement | null {
  if (el instanceof HTMLTextAreaElement) return el
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null
  let root = el
  while (root.parentElement?.isContentEditable) root = root.parentElement
  return root
}

export function withFallback(site: PlatformAdapter, generic: PlatformAdapter, onBroken: (adapter: string) => void): PlatformAdapter {
  /** Boxes the person wrote in that the site adapter missed */
  const fallback = new Set<HTMLElement>()
  let reported = false

  document.addEventListener("input", e => {
    const box = editableRoot(e.target)
    if (!box || fallback.has(box)) return
    if (generic.getText(box).length < BROKEN_AFTER_CHARS) return
    // Only where there should be a message box: a chat is open (or the
    // adapter says so), yet it finds none. Elsewhere — a page that isn't a
    // chat, or a search box beside a box it did find — it stays out on purpose.
    const expected = site.expectsBox ? site.expectsBox() : site.getConversationId() !== null
    if (!expected || site.findComposeBoxes().length > 0) return
    // Not a box the generic adapter would check either (hidden, code editor, password…)
    if (!generic.findComposeBoxes().includes(box)) return
    fallback.add(box)
    if (!reported) { reported = true; console.log(`Sentiment Guide: the ${site.id} adapter found no message box; checking this box the generic way`) }
    onBroken(site.id)
  }, true)

  const pick = (box: HTMLElement) => fallback.has(box) ? generic : site

  return {
    ...site,
    findComposeBoxes() {
      const own = site.findComposeBoxes()
      for (const box of fallback) if (!document.contains(box)) fallback.delete(box)
      return [...own, ...[...fallback].filter(b => !own.some(o => o.contains(b) || b.contains(o)))]
    },
    getText:     (box) => pick(box).getText(box),
    getEditingText: site.getEditingText || generic.getEditingText
      ? (box) => { const a = pick(box); return a.getEditingText ? a.getEditingText(box) : a.getText(box) }
      : undefined,
    replaceText: (box, target, text) => pick(box).replaceText(box, target, text),
    onSend:      (box, cb) => pick(box).onSend(box, cb),
    guardSend:   site.guardSend || generic.guardSend
      ? (box, check) => pick(box).guardSend?.(box, check) ?? (() => {})
      : undefined,
    sendNow:     site.sendNow || generic.sendNow
      ? (box) => pick(box).sendNow?.(box)
      : undefined,
  }
}
