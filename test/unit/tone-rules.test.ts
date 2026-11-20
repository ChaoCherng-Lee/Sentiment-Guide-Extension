import { describe, expect, it } from "vitest"
import { findToneTags } from "../../src/analysis/tone-tags"
import { applyBanterRule, applySensitivity, GENTLE_MIN_YELLOW_CONFIDENCE, verdictFromRaw } from "../../src/analysis/tone"
import type { ChatContext, ToneVerdict } from "../../src/analysis/types"

const TEASING: ChatContext = {
  platform: "whatsapp", q1: "close_friend", q2: "very_casual", q3: "yes", q4: "yes", q5: "normal", savedAt: 0,
}
const verdict = (tone: ToneVerdict["tone"]): ToneVerdict =>
  ({ tone, confidence: 0.8, flagged_phrase: "trash" })

describe("applyBanterRule", () => {
  it("lets a laughing tease through in a chat marked 'we joke and tease'", () => {
    for (const text of ["ur trash lmaooo", "you're trash lol", "trash hahaha", "trash 💀", "trash 😭😭"]) {
      expect(applyBanterRule(verdict("yellow"), text, TEASING)).toMatchObject({ tone: "green", flagged_phrase: "" })
    }
  })

  it("never softens red", () => {
    expect(applyBanterRule(verdict("red"), "trash lol", TEASING).tone).toBe("red")
  })

  it("needs laughter, and the teasing chat", () => {
    expect(applyBanterRule(verdict("yellow"), "you're trash", TEASING).tone).toBe("yellow")
    expect(applyBanterRule(verdict("yellow"), "trash lol", { ...TEASING, q2: "friendly" }).tone).toBe("yellow")
    expect(applyBanterRule(verdict("yellow"), "trash lol", null).tone).toBe("yellow")
  })

  it("doesn't mistake words that contain laughter for laughter", () => {
    expect(applyBanterRule(verdict("yellow"), "give me my lollipop back", TEASING).tone).toBe("yellow")
    expect(applyBanterRule(verdict("yellow"), "that's what i said, hahn", TEASING).tone).toBe("yellow")
  })
})

describe("findToneTags", () => {
  it("finds tags and what they mean", () => {
    expect(findToneTags("you're the worst /j /lh")).toEqual([
      { tag: "/j", meaning: "joking", notLiteral: true },
      { tag: "/lh", meaning: "light-hearted", notLiteral: true },
    ])
  })

  it("marks serious tags as literal", () => {
    expect(findToneTags("stop doing that /srs.")).toEqual([{ tag: "/srs", meaning: "serious", notLiteral: false }])
  })

  it("ignores slashes inside words and unknown codes", () => {
    expect(findToneTags("and/or path/j")).toEqual([])
    expect(findToneTags("see /xyz")).toEqual([])
  })

  it("is case-insensitive and lists each tag once", () => {
    expect(findToneTags("/J lol /j")).toEqual([{ tag: "/j", meaning: "joking", notLiteral: true }])
  })
})

describe("sensitivity", () => {
  const yellow = (confidence: number): ToneVerdict => ({ tone: "yellow", confidence, flagged_phrase: "fine" })

  it("Gentle lets an unsure yellow through, and keeps sure ones and every red", () => {
    expect(applySensitivity(yellow(0.8), "gentle")).toMatchObject({ tone: "green", flagged_phrase: "" })
    expect(applySensitivity(yellow(GENTLE_MIN_YELLOW_CONFIDENCE), "gentle").tone).toBe("yellow")
    expect(applySensitivity({ tone: "red", confidence: 0.5, flagged_phrase: "x" }, "gentle").tone).toBe("red")
  })

  it("Balanced and Strict keep the model's verdict", () => {
    expect(applySensitivity(yellow(0.8), "balanced").tone).toBe("yellow")
    expect(applySensitivity(yellow(0.8), "strict").tone).toBe("yellow")
  })

  it("applies after the answer is checked", () => {
    const raw = { tone: "yellow", confidence: 0.8, flagged_phrase: "fine" }
    expect(verdictFromRaw(raw, "fine, whatever", null, "gentle").tone).toBe("green")
    expect(verdictFromRaw(raw, "fine, whatever", null).tone).toBe("yellow")
  })
})
