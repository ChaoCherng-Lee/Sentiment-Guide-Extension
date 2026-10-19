import { beforeEach, describe, expect, it } from "vitest"
import { whatsapp } from "../../src/platforms/whatsapp"

/** A bubble shaped like WhatsApp's: text in span.selectable-text, plus the time. */
function bubble(from: "in" | "out", html: string | null) {
  const text = html === null
    ? `<img alt="">`
    : `<div class="copyable-text" data-pre-plain-text="[10:30, 19/10/2026] Alex: "><span class="selectable-text copyable-text"><span>${html}</span></span></div>`
  return `<div role="row"><div class="message-${from}">${text}<span class="time">10:30</span></div></div>`
}

describe("whatsapp.getRecentMessages", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="side">${bubble("in", "from the chat list")}</div><div id="main">${[
      bubble("in", "first"),
      bubble("out", "second"),
      bubble("in", null),
      bubble("in", `third <img alt="😂" data-plain-text="😂">`),
      bubble("out", "fourth"),
    ].join("")}</div>`
  })

  it("reads the newest text messages, oldest first, with who sent them", () => {
    expect(whatsapp.getRecentMessages(3)).toEqual([
      { from: "me", text: "second" },
      { from: "them", text: "third 😂" },
      { from: "me", text: "fourth" },
    ])
  })

  it("skips photos, leaves out the time, and only reads the open chat", () => {
    const all = whatsapp.getRecentMessages(10)
    expect(all.map(m => m.text)).toEqual(["first", "second", "third 😂", "fourth"])
  })

  it("returns nothing when no chat is open", () => {
    document.body.innerHTML = ""
    expect(whatsapp.getRecentMessages(6)).toEqual([])
  })
})
