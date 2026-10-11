import { describe, expect, it } from "vitest"
import { getPhraseRange, rangeFromOffsets } from "../../src/ui/dom-range"

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
