// =============================================================================
// Gmail adapter — every Gmail selector lives in this file.
//
// Differences from the chat sites:
// - several compose windows can be open; each gets its own ComposeSession
// - the "conversation" is the set of recipients of the compose window last
//   used (hash of the sorted addresses)
// - emails are long: a pause checks the paragraph being edited, and pressing
//   Send checks the whole email first (guardSend)
// - "recent messages" are the emails in the open thread when replying
// =============================================================================

import { readText } from "../ui/dom-range"
import { hashString } from "../util/hash"
import { observeLatest, pollConversation, replaceInBox } from "./shared"
import type { ChatMessage, IncomingMessage, PlatformAdapter } from "./types"

const BODY_SELECTORS = [
  'div[aria-label="Message Body"][contenteditable="true"]',
  'div[g_editable="true"][contenteditable="true"][role="textbox"]',
]
const SEND_BUTTON = 'div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label^="Send"]'
const RECIPIENT   = "[email], [data-hovercard-id]"
/** Quoted replies and signatures aren't the user's new words — don't check them */
const NOT_WRITTEN = ".gmail_quote, .gmail_signature, .gmail_extra, blockquote"

// The open thread: one .adn per email, sender in .gD[email], body in .a3s
const THREAD_MESSAGE = '[role="main"] .adn'
const SENDER = ".gD[email]"
const MESSAGE_BODY = ".a3s"

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/

/** The compose window around a body: the nearest ancestor holding its own Send button. */
export function composeRoot(box: HTMLElement): HTMLElement {
  let el: HTMLElement | null = box.parentElement
  for (let i = 0; el && i < 20; i++, el = el.parentElement) {
    if (el.querySelector(SEND_BUTTON)) return el
  }
  return box.parentElement ?? box
}

function sendButton(box: HTMLElement): HTMLElement | null {
  return composeRoot(box).querySelector<HTMLElement>(SEND_BUTTON)
}

/** Recipient addresses of one compose window, sorted. */
export function recipients(box: HTMLElement): string[] {
  const found = new Set<string>()
  for (const el of composeRoot(box).querySelectorAll(RECIPIENT)) {
    const addr = (el.getAttribute("email") ?? el.getAttribute("data-hovercard-id") ?? "").toLowerCase()
    if (EMAIL.test(addr) && !el.closest(THREAD_MESSAGE)) found.add(addr)
  }
  return [...found].sort()
}

/** The signed-in address, from the tab title ("Inbox - me@gmail.com - Gmail"). */
function ownAddress(): string | null {
  return document.title.match(EMAIL)?.[0].toLowerCase() ?? null
}

/** Text the user wrote: the body without quoted replies or signatures. */
function writtenText(box: HTMLElement): string {
  const copy = box.cloneNode(true) as HTMLElement
  copy.querySelectorAll(NOT_WRITTEN).forEach(el => el.remove())
  return readText(copy).trim()
}

const blockText = (n: Node) => (n.nodeType === Node.TEXT_NODE ? n.textContent ?? "" : readText(n)).trim()

/**
 * The paragraph the caret is in. Gmail writes each line as a block in the
 * body, with an empty block for a blank line, so a paragraph is the run of
 * non-empty lines around the caret. Falls back to the whole email when the
 * caret isn't in the box.
 */
export function paragraphAtCaret(box: HTMLElement): string {
  const sel = window.getSelection()
  let node  = sel?.focusNode ?? null
  if (!node || !box.contains(node)) return writtenText(box)
  if (node === box) node = box.childNodes[Math.min(sel!.focusOffset, box.childNodes.length - 1)] ?? null

  const lines = [...box.childNodes].filter(n => !(n instanceof Element && n.matches(NOT_WRITTEN)))
  const at = lines.findIndex(l => l === node || l.contains(node))
  if (at === -1) return writtenText(box)
  if (!blockText(lines[at])) return ""

  let start = at
  let end   = at
  while (start > 0 && blockText(lines[start - 1])) start--
  while (end < lines.length - 1 && blockText(lines[end + 1])) end++
  return lines.slice(start, end + 1).map(blockText).join("\n")
}

let lastUsed: HTMLElement | null = null

function threadMessages(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(THREAD_MESSAGE)]
}

function messageText(msg: HTMLElement): string {
  const body = msg.querySelector<HTMLElement>(MESSAGE_BODY)
  return body ? writtenText(body) : ""
}

function fromMe(msg: HTMLElement): boolean {
  const sender = msg.querySelector(SENDER)?.getAttribute("email")?.toLowerCase()
  return !!sender && sender === ownAddress()
}

export const gmail: PlatformAdapter = {
  id: "gmail",
  defaultStyle: "formal",
  // Recipients change while typing — don't pop the context form up each time
  askContextOnOpen: false,

  findComposeBoxes() {
    const boxes = new Set<HTMLElement>()
    for (const sel of BODY_SELECTORS) document.querySelectorAll<HTMLElement>(sel).forEach(b => boxes.add(b))
    for (const box of boxes) {
      if (!box.dataset.sgWatched) {
        box.dataset.sgWatched = "1"
        box.addEventListener("focusin", () => { lastUsed = box })
      }
    }
    return [...boxes]
  },

  getText: writtenText,

  getEditingText: paragraphAtCaret,

  getConversationId() {
    const box = lastUsed?.isConnected ? lastUsed : gmail.findComposeBoxes()[0]
    if (!box) return null
    const to = recipients(box)
    return to.length ? hashString("gmail:" + to.join(",")) : null
  },

  getConversationTitle() {
    const box = lastUsed?.isConnected ? lastUsed : gmail.findComposeBoxes()[0]
    const to = box ? recipients(box) : []
    return to.length ? to.join(", ") : null
  },

  getRecentMessages(limit) {
    const out: ChatMessage[] = []
    const all = threadMessages()
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const text = messageText(all[i])
      if (text) out.push({ from: fromMe(all[i]) ? "me" : "them", text })
    }
    return out.reverse()
  },

  observeIncoming(cb) {
    const read = (msg: HTMLElement): IncomingMessage | null => {
      const text = messageText(msg)
      if (!text) return null
      const id = msg.querySelector("[data-message-id]")?.getAttribute("data-message-id")
        ?? msg.querySelector("[data-legacy-message-id]")?.getAttribute("data-legacy-message-id") ?? ""
      // Badge next to the sender's name
      const anchor = msg.querySelector<HTMLElement>(SENDER)?.parentElement ?? undefined
      return { key: hashString(id + "\n" + text), text, element: msg, anchor }
    }
    return observeLatest(() => threadMessages().filter(m => !fromMe(m)), read, cb)
  },

  replaceText: replaceInBox,

  onSend(box, cb) {
    // Runs only for sends the guard lets through (it stops the others first)
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(SEND_BUTTON)
      if (btn && btn === sendButton(box)) cb()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) cb()
    }
    document.addEventListener("click", onClick)
    box.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("click", onClick)
      box.removeEventListener("keydown", onKey)
    }
  },

  checkWholeOnSend: true,
  // Gmail puts compose=… in the address while a compose window is open
  expectsBox: () => /[?&]compose=/.test(location.hash) || /[?&]compose=/.test(location.search),

  guardSend(box, check) {
    let letThrough = false
    let checking   = false
    const hold = (e: Event) => {
      if (letThrough) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (checking || e.type !== "click" && e.type !== "keydown") return
      checking = true
      Promise.resolve(check())
        .then(ok => { if (ok) gmail.sendNow!(box) })
        .finally(() => { checking = false })
    }
    // Gmail's buttons react to mousedown/mouseup as well as click: hold all three
    const onPointer = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.(SEND_BUTTON)
      if (btn && btn === sendButton(box)) hold(e)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) hold(e)
    }
    const types = ["mousedown", "mouseup", "click"] as const
    types.forEach(t => document.addEventListener(t, onPointer, true))
    box.addEventListener("keydown", onKey, true)
    // sendNow() clicks the button itself; let that one through
    guards.set(box, () => {
      letThrough = true
      queueMicrotask(() => { letThrough = false })
    })
    return () => {
      types.forEach(t => document.removeEventListener(t, onPointer, true))
      box.removeEventListener("keydown", onKey, true)
      guards.delete(box)
    }
  },

  sendNow(box) {
    const btn = sendButton(box)
    if (!btn) return
    guards.get(box)?.()
    for (const type of ["mousedown", "mouseup", "click"]) {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    }
  },

  onConversationChange(cb) {
    return pollConversation(() => gmail.getConversationId(), cb)
  },
}

/** Per compose box: lets the next send through the guard. */
const guards = new WeakMap<HTMLElement, () => void>()
