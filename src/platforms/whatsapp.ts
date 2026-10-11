// =============================================================================
// WhatsApp Web adapter — every WhatsApp selector lives in this file.
// =============================================================================

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
      document.execCommand("insertText", false, text)
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
    return box.innerText.trim()
  },

  getConversationId() {
    const name = getTitle()
    return name ? hashString(name) : null
  },

  getConversationTitle: getTitle,

  getRecentMessages(_limit: number): ChatMessage[] {
    return []
  },

  observeIncoming(_cb: (msg: IncomingMessage) => void) {
    return () => {}
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
