import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { boxText, caretIn, findInBox, placeCaret } from "../../src/ui/box-text"
import { replaceInBox } from "../../src/platforms/shared"

function textarea(value: string) {
  const el = document.createElement("textarea")
  el.value = value
  document.body.appendChild(el)
  return el
}

// happy-dom has no execCommand; act like a page that blocks it, so the
// fallback is what's tested here (the e2e tests cover execCommand in Chrome)
beforeEach(() => { (document as { execCommand: unknown }).execCommand = () => false })
afterEach(() => { document.body.innerHTML = "" })

describe("box text in a textarea", () => {
  it("reads the value, not the starting text", () => {
    const el = textarea("first")
    el.value = "you are so annoying\nbye"
    expect(boxText(el)).toBe("you are so annoying\nbye")
  })

  it("finds a phrase ignoring case", () => {
    const el = textarea("Honestly you're SO annoying")
    expect(findInBox(el, "so annoying")).toEqual({ start: 16, end: 27 })
    expect(findInBox(el, "lazy")).toBeNull()
    expect(findInBox(el, "")).toBeNull()
  })

  it("reads and puts back the caret only while focused", () => {
    const el = textarea("hello there")
    expect(caretIn(el)).toBeNull()
    el.focus()
    placeCaret(el, 5)
    expect(caretIn(el)).toBe(5)
  })

  it("replaces one span and leaves the rest", async () => {
    const el = textarea("ugh you're so annoying today")
    let inputs = 0
    el.addEventListener("input", () => inputs++)
    expect(await replaceInBox(el, { start: 11, end: 22 }, "a bit much")).toBe(true)
    expect(el.value).toBe("ugh you're a bit much today")
    expect(inputs).toBeGreaterThan(0)
  })

  it("replaces everything", async () => {
    const el = textarea("shut up")
    expect(await replaceInBox(el, "all", "Could you give me a minute?")).toBe(true)
    expect(el.value).toBe("Could you give me a minute?")
  })
})

describe("box text in a rich editor", () => {
  it("reads and finds through the DOM", () => {
    const el = document.createElement("div")
    el.contentEditable = "true"
    el.innerHTML = "<p>you are</p><p>so <b>annoying</b></p>"
    document.body.appendChild(el)
    expect(boxText(el)).toBe("you are\nso annoying")
    expect(findInBox(el, "SO ANNOYING")).toEqual({ start: 8, end: 19 })
  })
})
