// =============================================================================
// WhatsApp Web adapter — every WhatsApp selector lives in this file.
// =============================================================================

import { readText } from "../ui/dom-range"
import { hashString } from "../util/hash"
import { observeLatest, onEnterOrClick, pollConversation, replaceInBox } from "./shared"
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
  const stamp = bubble.querySelector<HTMLElement>("[data-pre-plain-text]")
  const key   = hashString((stamp?.getAttribute("data-pre-plain-text") ?? "") + "\n" + text)
  // The badge goes next to the text, so it reads as part of the message
  return { key, text, element: bubble, anchor: stamp ?? bubble }
}

function getTitle(): string | null {
  for (const sel of TITLE_SELECTORS) {
    const el = document.querySelector(sel)
    if (!el) continue
    const name = el.getAttribute("title") || el.textContent?.trim()
    if (name) return name
  }
  return null
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
    return observeLatest(() => [...document.querySelectorAll<HTMLElement>(INCOMING_BUBBLES)], readIncomingBubble, cb)
  },

  replaceText: replaceInBox,

  onSend(box, cb) {
    return onEnterOrClick(box, SEND_BUTTON, cb)
  },

  onConversationChange(cb) {
    return pollConversation(() => whatsapp.getConversationId(), cb)
  },
}
