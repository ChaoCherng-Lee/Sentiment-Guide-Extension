// =============================================================================
// Instagram web DMs adapter — every Instagram selector lives in this file.
//
// Instagram's class names are scrambled and change with every release, so
// this relies only on ARIA roles, labels, the URL and layout:
// - the thread ID comes from the URL (/direct/t/<id>/)
// - a message is a [role="row"] in the conversation [role="grid"]
// - who sent it: the "You sent" label screen readers get, else whether the
//   bubble sits on the right (me) or left (them) of the conversation
//
// Selectors are checked against saved pages in test/fixtures/instagram/ —
// when Instagram changes, save a fresh page there and fix what breaks.
// =============================================================================

import { readText } from "../ui/dom-range"
import { hashString } from "../util/hash"
import { observeLatest, onEnterOrClick, pollConversation, replaceInBox } from "./shared"
import type { ChatMessage, IncomingMessage, PlatformAdapter } from "./types"

const THREAD_PATH = /^\/direct\/t\/([^/]+)/

const COMPOSE_SELECTORS = [
  '[role="textbox"][contenteditable="true"][aria-label="Message"]',
  '[role="main"] [role="textbox"][contenteditable="true"]',
]

const CONVERSATION = '[role="grid"][aria-label^="Messages in conversation"], [role="main"] [role="grid"]'
const ROW = '[role="row"]'
const TEXT = 'div[dir="auto"], span[dir="auto"]'

const TITLE_SELECTORS = [
  '[role="main"] header h2',
  '[role="main"] header a[role="link"] span[dir="auto"]',
  '[role="main"] [role="button"] h2',
]

const SEND_BUTTON = '[role="button"][aria-label="Send"], div[role="button"]:has(> svg[aria-label="Send"])'

const threadId = () => location.pathname.match(THREAD_PATH)?.[1] ?? null

function conversationEl(): HTMLElement | null {
  return threadId() ? document.querySelector<HTMLElement>(CONVERSATION) : null
}

/** Text of a message row, or "" for photos, reels, reactions and dividers. */
function rowText(row: HTMLElement): string {
  // The innermost text blocks; skip the screen-reader "You sent" / name labels
  const parts = [...row.querySelectorAll<HTMLElement>(TEXT)]
    .filter(el => !el.querySelector(TEXT) && !isLabel(el))
    .map(el => readText(el).trim())
    .filter(Boolean)
  return parts.join(" ")
}

const LABEL = /^(you sent|.{1,40} sent)$/i

function isLabel(el: HTMLElement): boolean {
  return LABEL.test(el.textContent?.trim() ?? "")
}

/** Who sent a row: the accessible "You sent" label, else the side its bubble is on. */
export function sentByMe(row: HTMLElement, conversation: HTMLElement): boolean {
  const label = [...row.querySelectorAll<HTMLElement>("h5, h6, span, div")].find(isLabel)
  if (label) return /^you sent$/i.test(label.textContent!.trim())
  const text = [...row.querySelectorAll<HTMLElement>(TEXT)].find(el => !isLabel(el))
  if (!text) return false
  const box = conversation.getBoundingClientRect()
  const r   = text.getBoundingClientRect()
  return r.left + r.width / 2 > box.left + box.width / 2
}

function rows(): HTMLElement[] {
  const conv = conversationEl()
  return conv ? [...conv.querySelectorAll<HTMLElement>(ROW)] : []
}

function getTitle(): string | null {
  for (const sel of TITLE_SELECTORS) {
    const name = document.querySelector(sel)?.textContent?.trim()
    if (name) return name
  }
  return null
}

export const instagram: PlatformAdapter = {
  id: "instagram",

  findComposeBoxes() {
    // Only inside a DM thread — never the search or comment boxes
    if (!threadId()) return []
    for (const sel of COMPOSE_SELECTORS) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) return [el]
    }
    return []
  },

  getText(box) {
    return readText(box).trim()
  },

  getConversationId() {
    const id = threadId()
    return id ? hashString("instagram:" + id) : null
  },

  getConversationTitle: getTitle,

  getRecentMessages(limit) {
    const conv = conversationEl()
    if (!conv) return []
    const out: ChatMessage[] = []
    const all = rows()
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const text = rowText(all[i])
      if (text) out.push({ from: sentByMe(all[i], conv) ? "me" : "them", text })
    }
    return out.reverse()
  },

  observeIncoming(cb) {
    const incoming = () => {
      const conv = conversationEl()
      return conv ? rows().filter(r => rowText(r) && !sentByMe(r, conv)) : []
    }
    const read = (row: HTMLElement): IncomingMessage | null => {
      const text = rowText(row)
      if (!text) return null
      const index = rows().indexOf(row)
      // Rows have no IDs; thread + position + text is stable while the chat is open
      return { key: hashString(`${threadId()}:${index}:${text}`), text, element: row }
    }
    return observeLatest(incoming, read, cb)
  },

  replaceText: replaceInBox,

  onSend(box, cb) {
    return onEnterOrClick(box, SEND_BUTTON, cb)
  },

  onConversationChange(cb) {
    return pollConversation(() => instagram.getConversationId(), cb)
  },
}
