import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { composeRoot, gmail, paragraphAtCaret, recipients } from "../../src/platforms/gmail"
import type { IncomingMessage } from "../../src/platforms/types"

const PAGE = readFileSync(path.resolve("test/fixtures/gmail.html"), "utf8")

beforeEach(() => {
  const doc = new DOMParser().parseFromString(PAGE, "text/html")
  doc.querySelectorAll("script").forEach(s => s.remove())
  document.title = doc.title
  document.body.innerHTML = doc.body.innerHTML
})
afterEach(() => { document.body.innerHTML = "" })

const reply = () => document.querySelector<HTMLElement>('#reply [aria-label="Message Body"]')!

function putCaret(node: Node, offset: number) {
  const r = document.createRange()
  r.setStart(node, offset)
  r.collapse(true)
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(r)
}

describe("gmail adapter", () => {
  it("finds every compose body", () => {
    expect(gmail.findComposeBoxes()).toEqual([reply()])
    document.body.insertAdjacentHTML("beforeend",
      `<div role="dialog"><div aria-label="Message Body" contenteditable="true" role="textbox"></div><div role="button" data-tooltip="Send">Send</div></div>`)
    expect(gmail.findComposeBoxes()).toHaveLength(2)
  })

  it("finds the compose window and its recipients, not the thread's senders", () => {
    expect(composeRoot(reply()).id).toBe("reply")
    expect(recipients(reply())).toEqual(["alex@example.com"])
  })

  it("keys the conversation on the recipients", () => {
    const id = gmail.getConversationId()
    expect(id).toBeTruthy()
    document.querySelector("#reply [email]")!.setAttribute("email", "sam@example.com")
    expect(gmail.getConversationId()).not.toBe(id)
    expect(gmail.getConversationTitle()).toBe("sam@example.com")
  })

  it("checks only what the user wrote — not the quoted reply", () => {
    reply().firstElementChild!.textContent = "Sounds good."
    expect(gmail.getText(reply())).toBe("Sounds good.")
  })

  it("on a pause, checks the paragraph the caret is in", () => {
    reply().firstElementChild!.outerHTML = "<div>Hi Alex,</div><div><br></div><div>first line</div><div>second line</div><div><br></div><div>Thanks</div>"
    const lines = reply().querySelectorAll("div")
    putCaret(lines[2].firstChild!, 3)
    expect(paragraphAtCaret(reply())).toBe("first line\nsecond line")
    putCaret(lines[0].firstChild!, 0)
    expect(paragraphAtCaret(reply())).toBe("Hi Alex,")
  })

  it("reads the thread as recent messages, me vs them by sender, without quotes", () => {
    expect(gmail.getRecentMessages(6)).toEqual([
      { from: "them", text: "Hi! Are we still on for Saturday? Let me know by Thursday." },
      { from: "me", text: "Yes, should be fine." },
      { from: "them", text: "Great. Bring the board game this time, you forgot it last week." },
    ])
  })

  it("reports received emails, not the user's own", () => {
    const seen: IncomingMessage[] = []
    gmail.observeIncoming(m => seen.push(m))()
    expect(seen.map(m => m.text)).toEqual([
      "Hi! Are we still on for Saturday? Let me know by Thursday.",
      "Great. Bring the board game this time, you forgot it last week.",
    ])
    expect(seen[0].anchor?.tagName).toBe("H3")
  })

  it("is formal by default and doesn't pop up the context form", () => {
    expect(gmail.defaultStyle).toBe("formal")
    expect(gmail.askContextOnOpen).toBe(false)
  })
})
