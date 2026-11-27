import { describe, expect, it } from "vitest"
import { prepareRecent, RECENT_LIMIT, RECENT_MAX_CHARS, scrub, truncate } from "../../src/analysis/chat-context"
import type { ChatMessage } from "../../src/analysis/types"

const them = (text: string): ChatMessage => ({ from: "them", text })
const me   = (text: string): ChatMessage => ({ from: "me", text })

describe("scrub", () => {
  it("removes emails and phone numbers", () => {
    expect(scrub("mail me at sam.lee+x@gmail.com ok")).toBe("mail me at [email] ok")
    expect(scrub("call +61 412 345 678 or (08) 9266-7000")).toBe("call [phone] or [phone]")
  })

  it("leaves short numbers, times and dates alone", () => {
    expect(scrub("meet at 10:30 on 19/10, room 204, 3 people")).toBe("meet at 10:30 on 19/10, room 204, 3 people")
  })

  it("replaces the contact's name, and each part of it, with Them", () => {
    expect(scrub("Alex Smith said alex was late, smith too", ["Alex Smith"])).toBe("Them said Them was late, Them too")
  })

  it("only replaces whole words", () => {
    expect(scrub("Alexander and also Al", ["Al", "Alex"])).toBe("Alexander and also Them")
  })

  it("treats names as text, not patterns", () => {
    expect(scrub("hi Mr. B (sir)", ["Mr. B (sir)"])).toBe("hi Them")
  })
})

describe("truncate", () => {
  it("keeps short text as it is", () => {
    expect(truncate("hello")).toBe("hello")
  })

  it("cuts long text to the limit with an ellipsis, never splitting an emoji", () => {
    const out = truncate("ab👍🏽cd", 4)
    expect(out).toBe("ab👍🏽…")
    expect(truncate("x".repeat(500))).toHaveLength(RECENT_MAX_CHARS)
  })
})

describe("prepareRecent", () => {
  it(`keeps the last ${RECENT_LIMIT} messages with text, oldest first`, () => {
    const msgs = Array.from({ length: 9 }, (_, i) => (i % 2 ? me : them)(`m${i}`))
    msgs.splice(7, 0, them("   "))
    expect(prepareRecent(msgs).map(m => m.text)).toEqual(["m3", "m4", "m5", "m6", "m7", "m8"])
  })

  it("puts each message on one line and scrubs it", () => {
    expect(prepareRecent([them("Alex here\nmy number is 0412 345 678")], ["Alex", null]))
      .toEqual([{ from: "them", text: "Them here my number is [phone]" }])
  })
})
