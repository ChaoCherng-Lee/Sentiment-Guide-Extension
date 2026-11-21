import { describe, expect, it } from "vitest"
import {
  MAX_EDITS, validateAdvice, validateEdits, validateEmojiNotes, validateVerdict,
} from "../../src/analysis/schema"

const MSG = "ugh you are SO annoying, just leave me alone"

describe("validateVerdict", () => {
  it("keeps a well-formed verdict", () => {
    const verdict = { tone: "yellow", confidence: 0.8, flagged_phrase: "SO annoying" }
    expect(validateVerdict(verdict, MSG)).toEqual(verdict)
  })

  it("falls back to green for garbage", () => {
    expect(validateVerdict(null, MSG).tone).toBe("green")
    expect(validateVerdict("red", MSG).tone).toBe("green")
    expect(validateVerdict({ tone: "purple" }, MSG).tone).toBe("green")
  })

  it("clamps confidence and defaults it to 1", () => {
    expect(validateVerdict({ tone: "red", confidence: 7 }, MSG).confidence).toBe(1)
    expect(validateVerdict({ tone: "red", confidence: -1 }, MSG).confidence).toBe(0)
    expect(validateVerdict({ tone: "red", confidence: NaN }, MSG).confidence).toBe(1)
    expect(validateVerdict({ tone: "red" }, MSG).confidence).toBe(1)
  })

  it("drops a flagged phrase that isn't in the message", () => {
    expect(validateVerdict({ tone: "red", flagged_phrase: "so irritating" }, MSG).flagged_phrase).toBe("")
  })

  it("matches the flagged phrase case-insensitively", () => {
    expect(validateVerdict({ tone: "red", flagged_phrase: "so annoying" }, MSG).flagged_phrase).toBe("so annoying")
  })

  it("strips the flagged phrase from green verdicts", () => {
    expect(validateVerdict({ tone: "green", flagged_phrase: "annoying" }, MSG).flagged_phrase).toBe("")
  })
})

describe("validateAdvice", () => {
  it("keeps well-formed advice", () => {
    const advice = {
      label: "A little sharp", category: "dismissive", explanation: "Might sting.", suggestion: "I need some space right now",
      alternatives: ["can I have a minute?"],
      edits: [{ original: "leave me alone", replacement: "give me some space", reason: "sounds cold" }],
      emoji_notes: [],
    }
    expect(validateAdvice(advice, MSG)).toEqual(advice)
  })

  it("returns empty fields for garbage", () => {
    expect(validateAdvice(null, MSG)).toEqual({ label: "", category: "other", explanation: "", suggestion: "", alternatives: [], edits: [], emoji_notes: [] })
  })

  it("only allows categories from the fixed list, so no free text can reach a parent", () => {
    expect(validateAdvice({ category: "threat" }, MSG).category).toBe("threat")
    expect(validateAdvice({ category: "called them a loser" }, MSG).category).toBe("other")
  })

  it("drops a suggestion identical to the message", () => {
    expect(validateAdvice({ suggestion: ` ${MSG} ` }, MSG).suggestion).toBe("")
  })

  it("truncates long fields", () => {
    const r = validateAdvice({ label: "x".repeat(200), explanation: "y".repeat(1000), suggestion: "z".repeat(1000) }, MSG)
    expect(r.label).toHaveLength(60)
    expect(r.explanation).toHaveLength(300)
    expect(r.suggestion).toHaveLength(400)
  })
})

describe("validateEdits", () => {
  const e = (original: string, replacement = "x", reason = "why") => ({ original, replacement, reason })

  it("drops edits whose original isn't in the message", () => {
    expect(validateEdits([e("so irritating"), e("leave me alone")], MSG).map(x => x.original)).toEqual(["leave me alone"])
  })

  it("forgives case but keeps the message's own spelling", () => {
    expect(validateEdits([e("so annoying")], MSG)[0].original).toBe("SO annoying")
  })

  it("drops empty and no-op replacements", () => {
    expect(validateEdits([e("ugh", ""), e("ugh", "UGH"), e("", "hi")], MSG)).toEqual([])
  })

  it("allows an empty replacement only to remove an emoji", () => {
    const msg = "sure 🙄 whatever"
    expect(validateEdits([e("🙄", "")], msg)).toEqual([e("🙄", "")])
    expect(validateEdits([e("sure 🙄", "")], msg)).toEqual([])
  })

  it("accepts an emoji as the flagged phrase", () => {
    expect(validateVerdict({ tone: "yellow", flagged_phrase: "🙄" }, "sure 🙄").flagged_phrase).toBe("🙄")
  })

  it("drops edits that overlap an earlier one", () => {
    const r = validateEdits([e("SO annoying"), e("annoying, just"), e("leave me")], MSG)
    expect(r.map(x => x.original)).toEqual(["SO annoying", "leave me"])
  })

  it("keeps at most MAX_EDITS, sorted by position in the message", () => {
    const r = validateEdits([e("alone"), e("ugh"), e("leave"), e("annoying")], MSG)
    expect(r).toHaveLength(MAX_EDITS)
    expect(r.map(x => x.original)).toEqual(["ugh", "leave", "alone"])
  })

  it("keeps emoji in originals and replacements", () => {
    const msg = "ugh 😤 just leave me alone"
    expect(validateEdits([e("ugh 😤", "hey 🙂")], msg)).toEqual([e("ugh 😤", "hey 🙂")])
  })

  it("returns [] for garbage", () => {
    expect(validateEdits(null, MSG)).toEqual([])
    expect(validateEdits("nope", MSG)).toEqual([])
    expect(validateEdits([null, 3, { original: 5 }], MSG)).toEqual([])
  })
})

describe("validateEmojiNotes", () => {
  const msg = "ok 🙂 see you 👍🏽"

  it("keeps notes about emoji in the message", () => {
    const notes = [{ emoji: "🙂", reading: "can sound cold" }, { emoji: "👍🏽", reading: "a bit curt" }]
    expect(validateEmojiNotes(notes, msg)).toEqual(notes)
  })

  it("drops notes about emoji that aren't there, duplicates and garbage", () => {
    const notes = [
      { emoji: "🙄", reading: "eye roll" },
      { emoji: "🙂", reading: "cold" },
      { emoji: "🙂", reading: "again" },
      { emoji: "🙂" },
      null,
    ]
    expect(validateEmojiNotes(notes, msg)).toEqual([{ emoji: "🙂", reading: "cold" }])
    expect(validateEmojiNotes("nope", msg)).toEqual([])
  })
})

describe("validateAlternatives (10.2)", () => {
  it("keeps up to 2 real, different rewrites", async () => {
    const { validateAlternatives } = await import("../../src/analysis/schema")
    expect(validateAlternatives(["b", "B", "a", "msg", "", 3, "c", "d"], "msg", "a")).toEqual(["b", "c"])
    expect(validateAlternatives(["b"], "msg", "")).toEqual([])
    expect(validateAlternatives("b", "msg", "a")).toEqual([])
  })
})
