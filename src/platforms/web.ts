// =============================================================================
// Any other website — every text box the user writes in: plain <textarea>
// boxes (comments, posts, forms) and rich editors (contenteditable).
//
// Unlike the chat sites there is no conversation, no chat history and no
// received messages. "Don't check this …" switches off the whole site.
// =============================================================================

import { boxText } from "../ui/box-text"
import { replaceInBox } from "./shared"
import type { PlatformAdapter } from "./types"

/**
 * Boxes left alone: ones a page asks writing tools to skip (the same
 * attribute Grammarly honours), and code editors.
 */
const SKIP = [
  '[data-gramm="false"]', '[data-gramm_editor="false"]', '[data-sentiment-guide="off"]',
  ".CodeMirror", ".cm-editor", ".monaco-editor", ".ace_editor",
].join(", ")

/** Smaller than this is a hidden helper box or a one-word field, not somewhere people write */
const MIN_WIDTH  = 100
const MIN_HEIGHT = 16
/** After Enter, how long a chat-style box has to empty itself (= it sent) */
const SENT_CHECK_MS = 150

function writable(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) {
    if (el.readOnly || el.disabled) return false
  } else if (!el.isContentEditable || el.parentElement?.isContentEditable) {
    // Only the outermost element of a rich editor is the box
    return false
  }
  if (el.closest(SKIP)) return false
  const r = el.getBoundingClientRect()
  return r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT
}

export const web: PlatformAdapter = {
  id: "web",
  scope: "site",
  askContextOnOpen: false,

  findComposeBoxes() {
    return [...document.querySelectorAll<HTMLElement>("textarea, [contenteditable]")].filter(writable)
  },

  getText(box) {
    return boxText(box).trim()
  },

  // No chats on an ordinary website
  getConversationId: () => null,
  getConversationTitle: () => null,
  getRecentMessages: () => [],
  observeIncoming: () => () => {},
  onConversationChange: () => () => {},

  replaceText: replaceInBox,

  onSend(box, cb) {
    // A form posted, or a chat-style box that empties itself on Enter
    const form = box.closest("form")
    const onSubmit = () => cb()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return
      setTimeout(() => { if (!boxText(box).trim()) cb() }, SENT_CHECK_MS)
    }
    form?.addEventListener("submit", onSubmit)
    box.addEventListener("keydown", onKey)
    return () => {
      form?.removeEventListener("submit", onSubmit)
      box.removeEventListener("keydown", onKey)
    }
  },
}
