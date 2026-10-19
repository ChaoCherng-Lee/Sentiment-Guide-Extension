// Map between a compose box's text and DOM positions.
//
// Rich editors (WhatsApp's Lexical, Gmail, Instagram) split text across many
// nodes and may draw emoji as <img> elements, so we walk the box once into
// segments, concatenate their text, search that, and convert character
// offsets back to DOM boundary points. Every function here reads the text the
// same way, so offsets from one can be used with another.

/**
 * A piece of the box's text:
 * - text:  a Text node
 * - atom:  an emoji image, which counts as its alt text but can't be split
 * - break: a line break (<br> or the start of a new paragraph), no node offset
 */
type Segment =
  | { kind: "text"; node: Text; start: number; length: number }
  | { kind: "atom"; el: Element; start: number; length: number }
  | { kind: "break"; at: { node: Node; offset: number }; start: number; length: 1 }

const BLOCKS = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"])

/** The text an emoji image stands for, or null if the element isn't one. */
function emojiText(el: Element): string | null {
  const plain = el.getAttribute("data-plain-text")
  if (plain) return plain
  if (el.tagName === "IMG") return el.getAttribute("alt") || null
  return null
}

function indexInParent(node: Node): number {
  return Array.prototype.indexOf.call(node.parentNode!.childNodes, node)
}

function collectSegments(container: Node): { segments: Segment[]; full: string } {
  const segments: Segment[] = []
  let full = ""

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (length) segments.push({ kind: "text", node: node as Text, start: full.length, length })
      full += node.textContent ?? ""
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element

    const emoji = emojiText(el)
    if (emoji) {
      segments.push({ kind: "atom", el, start: full.length, length: emoji.length })
      full += emoji
      return
    }
    if (el.tagName === "BR") {
      // A lone <br> in an empty paragraph is a placeholder, not a line break
      if (el.parentNode?.childNodes.length === 1 && BLOCKS.has((el.parentNode as Element).tagName)) return
      segments.push({ kind: "break", at: { node: el.parentNode!, offset: indexInParent(el) + 1 }, start: full.length, length: 1 })
      full += "\n"
      return
    }
    // A new paragraph starts a new line, unless we are already on one
    if (BLOCKS.has(el.tagName) && el !== container && full && !full.endsWith("\n")) {
      segments.push({ kind: "break", at: { node: el, offset: 0 }, start: full.length, length: 1 })
      full += "\n"
    }
    el.childNodes.forEach(visit)
  }

  container.childNodes.forEach(visit)
  return { segments, full }
}

/** The box's text, with emoji images as their characters and line breaks as "\n". */
export function readText(container: Node): string {
  return collectSegments(container).full
}

type Point = { node: Node; offset: number }

/**
 * DOM boundary point for a character offset. At a boundary between segments
 * a range start belongs to the next one and a range end to the previous one.
 * Offsets inside an emoji image snap to its edge.
 */
function pointAt(segments: Segment[], offset: number, isEnd: boolean): Point | null {
  const ordered = isEnd ? [...segments].reverse() : segments
  for (const seg of ordered) {
    const end = seg.start + seg.length
    const inside = isEnd ? offset > seg.start && offset <= end : offset >= seg.start && offset < end
    if (!inside) continue
    switch (seg.kind) {
      case "text":
        return { node: seg.node, offset: offset - seg.start }
      case "atom": {
        const parent = seg.el.parentNode!
        const index  = indexInParent(seg.el)
        return isEnd ? { node: parent, offset: index + 1 } : { node: parent, offset: index }
      }
      case "break":
        return seg.at
    }
  }
  return null
}

/** Range covering characters [start, end) of the container's text, or null. */
export function rangeFromOffsets(container: Node, start: number, end: number): Range | null {
  const { segments } = collectSegments(container)
  const a = pointAt(segments, start, false)
  const b = pointAt(segments, end, true)
  if (!a || !b) return null
  try {
    const doc = container.ownerDocument ?? document
    const range = doc.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    return range
  } catch (_) {
    return null
  }
}

/** Character offsets of the first case-insensitive match of `phrase`, or null. */
export function findPhrase(container: Node, phrase: string): { start: number; end: number } | null {
  if (!phrase) return null
  const { full } = collectSegments(container)
  const idx = full.toLowerCase().indexOf(phrase.toLowerCase())
  return idx === -1 ? null : { start: idx, end: idx + phrase.length }
}

/** Range covering the first case-insensitive match of `phrase`, or null. */
export function getPhraseRange(container: Node, phrase: string): Range | null {
  const at = findPhrase(container, phrase)
  return at ? rangeFromOffsets(container, at.start, at.end) : null
}

/** The caret's character offset in the container's text, or null if it isn't inside. */
export function getCaretOffset(container: Node): number | null {
  const doc = container.ownerDocument ?? document
  const sel = doc.getSelection()
  if (!sel?.rangeCount || !sel.focusNode || !container.contains(sel.focusNode)) return null

  const before = doc.createRange()
  before.setStart(container, 0)
  before.setEnd(sel.focusNode, sel.focusOffset)
  const isBefore = (node: Node, offset: number) => before.comparePoint(node, offset) === 0

  let count = 0
  for (const seg of collectSegments(container).segments) {
    if (seg.kind === "text" && seg.node === sel.focusNode) return count + Math.min(sel.focusOffset, seg.length)
    const endPoint = seg.kind === "text" ? { node: seg.node, offset: seg.length }
      : seg.kind === "atom" ? { node: seg.el.parentNode!, offset: indexInParent(seg.el) + 1 }
      : seg.at
    if (!isBefore(endPoint.node, endPoint.offset)) break
    count += seg.length
  }
  return count
}

/** Put a collapsed caret at a character offset in the container's text. */
export function setCaretOffset(container: Node, offset: number): boolean {
  const { segments } = collectSegments(container)
  const at = pointAt(segments, offset, true) ?? pointAt(segments, offset, false)
  if (!at) return false
  const doc = container.ownerDocument ?? document
  const range = doc.createRange()
  range.setStart(at.node, at.offset)
  range.collapse(true)
  const sel = doc.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  return true
}

/**
 * Where the caret should go after [start, end) is replaced by `insertedLength`
 * characters, so it stays next to the same text: before the edit it doesn't
 * move, after it shifts by the change in length, inside it goes to the end.
 */
export function caretAfterEdit(caret: number, start: number, end: number, insertedLength: number): number {
  if (caret <= start) return caret
  if (caret >= end) return caret + insertedLength - (end - start)
  return start + insertedLength
}
