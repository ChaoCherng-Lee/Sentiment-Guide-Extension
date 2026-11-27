// The text of a compose box, whatever kind of box it is: a plain <textarea>
// (most websites) or a rich editor (contenteditable: WhatsApp, Instagram,
// Gmail). Offsets from one function here can be used with another.
//
// A textarea has no DOM nodes for its text, so where a phrase sits on screen
// is measured on a hidden copy of the box with the same font and wrapping.

import { findPhrase, getCaretOffset, getPhraseRange, readText, setCaretOffset } from "./dom-range"

/** Characters [start, end) of a box's text. */
export interface Span { start: number; end: number }

export const isTextarea = (box: HTMLElement): box is HTMLTextAreaElement => box instanceof HTMLTextAreaElement

/** Everything in the box, with line breaks as "\n". */
export function boxText(box: HTMLElement): string {
  return isTextarea(box) ? box.value : readText(box)
}

/** The first case-insensitive match of `phrase`, or null. */
export function findInBox(box: HTMLElement, phrase: string): Span | null {
  if (!isTextarea(box)) return findPhrase(box, phrase)
  if (!phrase) return null
  const i = box.value.toLowerCase().indexOf(phrase.toLowerCase())
  return i === -1 ? null : { start: i, end: i + phrase.length }
}

/** The caret's offset in the box's text, or null if the box isn't focused. */
export function caretIn(box: HTMLElement): number | null {
  if (!isTextarea(box)) return getCaretOffset(box)
  return document.activeElement === box ? box.selectionEnd : null
}

export function placeCaret(box: HTMLElement, offset: number): boolean {
  if (!isTextarea(box)) return setCaretOffset(box, offset)
  box.setSelectionRange(offset, offset)
  return true
}

/** Where `phrase` is drawn on screen (viewport coordinates), or null if it isn't in the box. */
export function phraseRects(box: HTMLElement, phrase: string): DOMRect[] | null {
  if (!isTextarea(box)) {
    const range = getPhraseRange(box, phrase)
    return range ? Array.from(range.getClientRects()) : null
  }
  const at = findInBox(box, phrase)
  return at ? textareaRects(box, at) : null
}

/** What decides where text wraps in a textarea, copied onto the measuring copy. */
const COPIED = [
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily", "lineHeight",
  "letterSpacing", "wordSpacing", "textTransform", "textIndent", "textAlign", "tabSize", "direction",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "whiteSpace", "wordBreak", "overflowWrap",
] as const

/**
 * Screen rectangles of characters [start, end) in a textarea: a hidden div
 * laid over the box with the same font, padding and width wraps the text the
 * same way, then the box's own scrolling is taken off. Parts scrolled out of
 * the box are left out.
 */
function textareaRects(box: HTMLTextAreaElement, at: Span): DOMRect[] {
  const style  = getComputedStyle(box)
  const bounds = box.getBoundingClientRect()
  const copy   = document.createElement("div")
  for (const prop of COPIED) copy.style[prop] = style[prop]
  // clientWidth leaves out the scrollbar, which the copy doesn't have
  const width = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  Object.assign(copy.style, {
    position: "fixed", top: `${bounds.top}px`, left: `${bounds.left}px`,
    boxSizing: "content-box", width: `${width}px`,
    borderStyle: "solid", borderColor: "transparent",
    visibility: "hidden", pointerEvents: "none", overflow: "hidden",
    whiteSpace: style.whiteSpace === "pre" ? "pre" : "pre-wrap",
  })
  const mark = document.createElement("span")
  mark.textContent = box.value.slice(at.start, at.end)
  copy.append(box.value.slice(0, at.start), mark, box.value.slice(at.end))
  document.body.appendChild(copy)
  const raw = Array.from(mark.getClientRects())
  copy.remove()

  // The part of the box text is drawn in (inside the border)
  const top    = bounds.top + box.clientTop
  const left   = bounds.left + box.clientLeft
  const bottom = top + box.clientHeight
  const right  = left + box.clientWidth
  return raw
    .map(r => new DOMRect(r.left - box.scrollLeft, r.top - box.scrollTop, r.width, r.height))
    .filter(r => r.bottom > top + 2 && r.top < bottom - 2 && r.right > left && r.left < right)
}
