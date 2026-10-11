import { describe, expect, it } from "vitest"
import { validateToneResult } from "../../src/analysis/schema"

const MSG = "ugh you are SO annoying, just leave me alone"

describe("validateToneResult", () => {
  it("keeps a well-formed result", () => {
    const result = {
      tone: "yellow", confidence: 0.8, label: "A little sharp", explanation: "Might sting.",
      flagged_phrase: "SO annoying", suggestion: "I need some space right now", tone_tags_detected: false,
    }
    expect(validateToneResult(result, MSG)).toEqual(result)
  })

  it("falls back to green for garbage", () => {
    expect(validateToneResult(null, MSG).tone).toBe("green")
    expect(validateToneResult("red", MSG).tone).toBe("green")
    expect(validateToneResult({ tone: "purple" }, MSG).tone).toBe("green")
  })

  it("clamps confidence and defaults it to 1", () => {
    expect(validateToneResult({ tone: "red", confidence: 7 }, MSG).confidence).toBe(1)
    expect(validateToneResult({ tone: "red", confidence: -1 }, MSG).confidence).toBe(0)
    expect(validateToneResult({ tone: "red", confidence: NaN }, MSG).confidence).toBe(1)
    expect(validateToneResult({ tone: "red" }, MSG).confidence).toBe(1)
  })

  it("drops a flagged phrase that isn't in the message", () => {
    expect(validateToneResult({ tone: "red", flagged_phrase: "so irritating" }, MSG).flagged_phrase).toBe("")
  })

  it("matches the flagged phrase case-insensitively", () => {
    expect(validateToneResult({ tone: "red", flagged_phrase: "so annoying" }, MSG).flagged_phrase).toBe("so annoying")
  })

  it("drops a suggestion identical to the message", () => {
    expect(validateToneResult({ tone: "yellow", suggestion: ` ${MSG} ` }, MSG).suggestion).toBe("")
  })

  it("strips phrase and suggestion from green results", () => {
    const r = validateToneResult({ tone: "green", flagged_phrase: "annoying", suggestion: "hi" }, MSG)
    expect(r.flagged_phrase).toBe("")
    expect(r.suggestion).toBe("")
  })

  it("truncates long fields", () => {
    const r = validateToneResult({ tone: "red", label: "x".repeat(200), explanation: "y".repeat(1000) }, MSG)
    expect(r.label).toHaveLength(60)
    expect(r.explanation).toHaveLength(300)
  })
})
