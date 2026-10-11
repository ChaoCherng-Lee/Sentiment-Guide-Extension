// Map a phrase in a compose box's text back to a DOM Range.
//
// Rich editors (WhatsApp's Lexical, Gmail, Instagram) split text across many
// nodes, so we walk every text node, concatenate them, find the phrase, and
// convert the character offsets back to (node, offset) pairs.

interface TextNodeEntry {
  node: Text
  start: number
}

function collectTextNodes(container: Node): { nodes: TextNodeEntry[]; full: string } {
  const doc = container.ownerDocument ?? document
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: TextNodeEntry[] = []
  let full = ""
  let node: Node | null
  while ((node = walker.nextNode())) {
    nodes.push({ node: node as Text, start: full.length })
    full += node.textContent ?? ""
  }
  return { nodes, full }
}

function locate(nodes: TextNodeEntry[], offset: number, preferEnd: boolean): { node: Text; offset: number } | null {
  for (const entry of nodes) {
    const len = entry.node.textContent?.length ?? 0
    const end = entry.start + len
    // At a boundary between nodes, a range start belongs to the next node and
    // a range end to the previous one
    if (preferEnd ? offset > entry.start && offset <= end : offset >= entry.start && offset < end) {
      return { node: entry.node, offset: offset - entry.start }
    }
  }
  return null
}

/** Range covering characters [start, end) of the container's text, or null. */
export function rangeFromOffsets(container: Node, start: number, end: number): Range | null {
  const { nodes } = collectTextNodes(container)
  const a = locate(nodes, start, false)
  const b = locate(nodes, end, true)
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

/** Range covering the first case-insensitive match of `phrase`, or null. */
export function getPhraseRange(container: Node, phrase: string): Range | null {
  if (!phrase) return null
  const { full } = collectTextNodes(container)
  const idx = full.toLowerCase().indexOf(phrase.toLowerCase())
  if (idx === -1) return null
  return rangeFromOffsets(container, idx, idx + phrase.length)
}
