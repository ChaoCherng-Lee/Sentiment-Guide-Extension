import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The labelled set in eval/messages.jsonl is what every prompt and model
// change is scored against (Spec NFR-1), so a broken line must fail here
// rather than skew a run.

const rows = readFileSync("eval/messages.jsonl", "utf8")
  .split("\n")
  .filter(l => l.trim())
  .map((l, i) => ({ line: i + 1, row: JSON.parse(l) }))

const TONES = ["green", "yellow", "red"]
const SPEC_CATEGORIES = [
  "harsh", "passive_aggressive", "blunt_fine", "banter", "profanity",
  "emoji", "sarcasm", "neutral", "non_english", "slang", "tense",
]

describe("eval set", () => {
  it("has at least 400 messages", () => {
    expect(rows.length).toBeGreaterThanOrEqual(400)
  })

  it("every line has an id, a category, some text and a known label", () => {
    for (const { line, row } of rows) {
      expect(Number.isInteger(row.id), `line ${line}`).toBe(true)
      expect(typeof row.category, `line ${line}`).toBe("string")
      expect(row.text?.trim(), `line ${line}`).toBeTruthy()
      expect(TONES, `line ${line}`).toContain(row.expected)
      if (row.recent) {
        for (const m of row.recent) expect(["me", "them"], `line ${line}`).toContain(m.from)
      }
    }
  })

  it("ids are unique", () => {
    const ids = rows.map(r => r.row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("the same text has the same label unless it comes with a chat or a context", () => {
    const plain = new Map<string, string>()
    for (const { row } of rows) {
      if (row.recent || row.context) continue
      const seen = plain.get(row.text)
      if (seen) expect(row.expected, row.text).toBe(seen)
      plain.set(row.text, row.expected)
    }
  })

  it("each category the Spec names has at least 30 messages", () => {
    for (const cat of SPEC_CATEGORIES) {
      expect(rows.filter(r => r.row.category === cat).length, cat).toBeGreaterThanOrEqual(30)
    }
  })

  it("there are fine messages to measure false flags against", () => {
    expect(rows.filter(r => r.row.expected === "green").length).toBeGreaterThanOrEqual(150)
  })
})
