import { describe, expect, it } from "vitest"
import { validateAdvice, validateVerdict } from "../../src/analysis/schema"

const MSG = "ugh you are SO annoying, just leave me alone"

describe("validateVerdict", () => {
  it("keeps a well-formed verdict", () => {
    const verdict = { tone: "yellow", confidence: 0.8, flagged_phrase: "SO annoying", tone_tags_detected: false }
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
    const advice = { label: "A little sharp", explanation: "Might sting.", suggestion: "I need some space right now" }
    expect(validateAdvice(advice, MSG)).toEqual(advice)
  })

  it("returns empty fields for garbage", () => {
    expect(validateAdvice(null, MSG)).toEqual({ label: "", explanation: "", suggestion: "" })
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
