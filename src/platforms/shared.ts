// Helpers shared by the site adapters. Nothing here knows a site's selectors.

import type { IncomingMessage } from "./types"

/**
 * Put `text` in place of the current selection. Lexical-style editors
 * (WhatsApp, Instagram) sync their selection from the selectionchange event
 * that follows a selection change, so insertText is deferred past it —
 * otherwise the editor inserts at the old caret.
 */
export function insertOverSelection(box: HTMLElement, select: () => void, text: string): Promise<boolean> {
  const before = box.innerText
  box.focus()
  select()
  return new Promise(resolve => {
    setTimeout(() => {
      box.focus()
      if (text) document.execCommand("insertText", false, text)
      else document.execCommand("delete", false)
      resolve(box.innerText !== before)
    }, 0)
  })
}

/** replaceText() for editors that take execCommand: the whole box, or one range. */
export function replaceInBox(box: HTMLElement, range: Range | "all", text: string): Promise<boolean> {
  return insertOverSelection(box, () => {
    if (range === "all") {
      document.execCommand("selectAll", false)
    } else {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, text)
}

/** Messages read when a chat opens (Plan 3.1: the backlog is never analysed). */
export const INCOMING_LATEST = 3
const INCOMING_SCAN_MS = 300

/**
 * Report new incoming messages: the last few when watching starts (a chat
 * opening), then ones that arrive after the newest already seen. Older
 * messages loaded above (scrolling up) are never reported.
 * `list` returns the incoming message elements in page order.
 */
export function observeLatest(
  list: () => HTMLElement[],
  read: (el: HTMLElement) => IncomingMessage | null,
  cb: (msg: IncomingMessage) => void,
): () => void {
  const seen = new WeakSet<HTMLElement>()
  const scan = () => {
    const items = list()
    let newestSeen = -1
    items.forEach((el, i) => { if (seen.has(el)) newestSeen = i })
    const from = Math.max(newestSeen + 1, items.length - INCOMING_LATEST)
    items.forEach(el => seen.add(el))
    for (const el of items.slice(from)) {
      const msg = read(el)
      if (msg) cb(msg)
    }
  }
  let queued = false
  const observer = new MutationObserver(() => {
    if (queued) return
    queued = true
    setTimeout(() => { queued = false; scan() }, INCOMING_SCAN_MS)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  scan()
  return () => observer.disconnect()
}

const CHAT_SWITCH_POLL_MS = 1200

/** Call `cb` when `getId()` changes to a new conversation. */
export function pollConversation(getId: () => string | null, cb: () => void): () => void {
  let last = getId()
  const timer = setInterval(() => {
    const id = getId()
    if (!id || id === last) return
    last = id
    cb()
  }, CHAT_SWITCH_POLL_MS)
  return () => clearInterval(timer)
}

/** Send key handling shared by chat sites: Enter (not Shift+Enter) or a click on the send button. */
export function onEnterOrClick(box: HTMLElement, sendButton: string, cb: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) cb()
  }
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest?.(sendButton)) cb()
  }
  box.addEventListener("keydown", onKey)
  document.addEventListener("click", onClick, true)
  return () => {
    box.removeEventListener("keydown", onKey)
    document.removeEventListener("click", onClick, true)
  }
}
