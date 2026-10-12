import { describe, expect, it } from "vitest"
import {
  caretAfterEdit, findPhrase, getCaretOffset, getPhraseRange, rangeFromOffsets, setCaretOffset,
} from "../../src/ui/dom-range"

function box(html: string) {
  const el = document.createElement("div")
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

describe("getPhraseRange", () => {
  it("finds a phrase inside one text node", () => {
    const el = box("<p>you are so annoying</p>")
    expect(getPhraseRange(el, "so annoying")?.toString()).toBe("so annoying")
  })

  it("finds a phrase split across several nodes (rich editors)", () => {
    const el = box("<p><span>you are so </span><strong>anno</strong><span>ying today</span></p>")
    expect(getPhraseRange(el, "so annoying")?.toString()).toBe("so annoying")
  })

  it("is case-insensitive", () => {
    const el = box("<p>SHUT UP</p>")
    expect(getPhraseRange(el, "shut up")?.toString()).toBe("SHUT UP")
  })

  it("returns null when the phrase is missing or empty", () => {
    const el = box("<p>hello</p>")
    expect(getPhraseRange(el, "bye")).toBeNull()
    expect(getPhraseRange(el, "")).toBeNull()
  })

  it("handles emoji (surrogate pairs) before the phrase", () => {
    const el = box("<p>🙄🙄 whatever loser</p>")
    expect(getPhraseRange(el, "loser")?.toString()).toBe("loser")
  })

  it("puts a range ending at a node boundary in the earlier node", () => {
    const el = box("<span>abc</span><span>def</span>")
    const r = rangeFromOffsets(el, 1, 3)!
    expect(r.toString()).toBe("bc")
    expect(r.endContainer.textContent).toBe("abc")
  })
})

describe("findPhrase", () => {
  it("returns character offsets across nodes, counting emoji as the browser does", () => {
    const el = box("<p><span>hey 😤 you are </span><b>so</b> annoying</p>")
    expect(findPhrase(el, "so annoying")).toEqual({ start: 15, end: 26 })
  })
})

describe("caret offsets", () => {
  it("reads and sets the caret across several nodes", () => {
    const el = box("<p><span>you are </span><b>so</b><span> annoying</span></p>")
    expect(setCaretOffset(el, 10)).toBe(true)
    expect(getCaretOffset(el)).toBe(10)
    expect(setCaretOffset(el, 0)).toBe(true)
    expect(getCaretOffset(el)).toBe(0)
  })

  it("returns null when the caret is somewhere else", () => {
    const el = box("<p>hello</p>")
    const other = box("<p>elsewhere</p>")
    setCaretOffset(other, 2)
    expect(getCaretOffset(el)).toBeNull()
  })
})

describe("caretAfterEdit", () => {
  // "you are so stupid, ok" — replace "so stupid" [8, 17) with "wrong" (5 chars)
  it("doesn't move a caret before the edit", () => {
    expect(caretAfterEdit(3, 8, 17, 5)).toBe(3)
    expect(caretAfterEdit(8, 8, 17, 5)).toBe(8)
  })

  it("shifts a caret after the edit by the change in length", () => {
    expect(caretAfterEdit(21, 8, 17, 5)).toBe(17)
    expect(caretAfterEdit(17, 8, 17, 5)).toBe(13)
  })

  it("puts a caret inside the edit at its end", () => {
    expect(caretAfterEdit(12, 8, 17, 5)).toBe(13)
  })
})
