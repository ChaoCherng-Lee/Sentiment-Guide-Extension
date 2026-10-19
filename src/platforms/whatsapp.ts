// =============================================================================
// WhatsApp Web adapter — every WhatsApp selector lives in this file.
// =============================================================================

import { readText } from "../ui/dom-range"
import { hashString } from "../util/hash"
import type { ChatMessage, IncomingMessage, PlatformAdapter } from "./types"

const COMPOSE_SELECTORS = [
  '[contenteditable="true"][data-tab="10"]',
  'footer [contenteditable="true"][role="textbox"]',
  '[data-testid="conversation-compose-box-input"] [contenteditable="true"]',
  '#main [contenteditable="true"][role="textbox"]',
]

const TITLE_SELECTORS = [
  '[data-testid="conversation-info-header-chat-title"]',
  '#main header span[title]',
  '#main header ._amig span',
]

const SEND_BUTTON = '[data-testid="send"], [data-icon="send"], button[aria-label="Send"]'

// Message bubbles in the open chat, and the element holding just their text
// (not the time, ticks or a quoted message)
const BUBBLES = "#main .message-in, #main .message-out"
const BUBBLE_TEXT = ["[data-pre-plain-text] span.selectable-text", "span.selectable-text"]
const INCOMING_BUBBLES = "#main .message-in"
/** Incoming messages read when a chat opens (Plan 3.1: the backlog is never analysed) */
const INCOMING_LATEST = 3
const INCOMING_SCAN_MS = 300

function bubbleText(bubble: HTMLElement): string {
  const el = BUBBLE_TEXT.map(sel => bubble.querySelector<HTMLElement>(sel)).find(Boolean)
  return el ? readText(el).trim() : ""
}

/**
 * An incoming bubble with text, keyed by its time + sender line and text, so
 * the same message keeps its key when WhatsApp redraws the bubble.
 */
function readIncomingBubble(bubble: HTMLElement): IncomingMessage | null {
  const text = bubbleText(bubble)
  if (!text) return null
  const stamp = bubble.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") ?? ""
  return { key: hashString(stamp + "\n" + text), text, element: bubble }
}

const CHAT_SWITCH_POLL_MS = 1200

function getTitle(): string | null {
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector(sel)
    if (!el) continue
    const name = el.getAttribute("title") || el.textContent?.trim()
    if (name) return name
  }
  return null
}

/**
 * Put `text` in place of the current selection. WhatsApp's Lexical editor
 * syncs its internal selection from the selectionchange event that follows a
 * selection change, so insertText must be deferred past it — otherwise
 * Lexical doesn't see the selection and inserts at the old caret.
 */
function insertOverSelection(box: HTMLElement, select: () => void, text: string): Promise<boolean> {
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

export const whatsapp: PlatformAdapter = {
  id: "whatsapp",

  findComposeBoxes() {
    // No "any contenteditable" fallback — it can latch onto the search bar
    for (const sel of COMPOSE_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el && !el.closest("#side")) return [el]
    }
    return []
  },

  getText(box) {
    // Not innerText: WhatsApp may draw emoji as images, which innerText skips
    return readText(box).trim()
  },

  getConversationId() {
    const name = getTitle()
    return name ? hashString(name) : null
  },

  getConversationTitle: getTitle,

  getRecentMessages(limit) {
    const out: ChatMessage[] = []
    const bubbles = document.querySelectorAll<HTMLElement>(BUBBLES)
    // Newest first, so only the last few bubbles are read
    for (let i = bubbles.length - 1; i >= 0 && out.length < limit; i--) {
      const bubble = bubbles[i]
      const text = bubbleText(bubble)
      // Photos, stickers and deleted messages have no text — skip them
      if (text) out.push({ from: bubble.classList.contains("message-out") ? "me" : "them", text })
    }
    return out.reverse()
  },

  observeIncoming(cb) {
    // Only the last few incoming bubbles are ever reported: on opening a chat
    // that's its latest messages (not the backlog), after that it's new ones
    // as they arrive, and older messages loaded by scrolling up never are.
    const seen = new WeakSet<HTMLElement>()
    const scan = () => {
      const incoming = [...document.querySelectorAll<HTMLElement>(INCOMING_BUBBLES)]
      // New = after the newest bubble already seen, and among the last few
      let newestSeen = -1
      incoming.forEach((b, i) => { if (seen.has(b)) newestSeen = i })
      const from = Math.max(newestSeen + 1, incoming.length - INCOMING_LATEST)
      incoming.forEach(b => seen.add(b))
      for (const bubble of incoming.slice(from)) {
        const msg = readIncomingBubble(bubble)
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
  },

  replaceText(box, range, text) {
    return insertOverSelection(box, () => {
      if (range === "all") {
        document.execCommand("selectAll", false)
      } else {
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }, text)
  },

  onSend(box, cb) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) cb()
    }
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(SEND_BUTTON)) cb()
    }
    box.addEventListener("keydown", onKey)
    document.addEventListener("click", onClick, true)
    return () => {
      box.removeEventListener("keydown", onKey)
      document.removeEventListener("click", onClick, true)
    }
  },

  onConversationChange(cb) {
    let last = whatsapp.getConversationId()
    const timer = setInterval(() => {
      const id = whatsapp.getConversationId()
      if (!id || id === last) return
      last = id
      cb()
    }, CHAT_SWITCH_POLL_MS)
    return () => clearInterval(timer)
  },
}
