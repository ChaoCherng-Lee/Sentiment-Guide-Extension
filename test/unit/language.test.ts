import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { APPROVED_LANGUAGES, guessLanguage, unsupportedLanguage } from "../../src/analysis/language"
import { languageName } from "../../src/ui/status-badge"

interface Case { id: number; category: string; text: string; expected: string }
const cases: Case[] = readFileSync("eval/messages.jsonl", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
// Mixed English (Singlish, Manglish) is English enough to check
const MIXED = new Set([316, 317, 318])
const foreign = cases.filter(c => c.category === "non_english" && !MIXED.has(c.id))
const english = cases.filter(c => c.category !== "non_english" || MIXED.has(c.id))

describe("language check", () => {
  it("never skips an English message in the test set: a skipped hurtful message goes unchecked", () => {
    const skipped = english.filter(c => unsupportedLanguage(c.text, "ollama"))
    expect(skipped.map(c => `#${c.id} ${c.text}`)).toEqual([])
  })

  it("finds nearly all of the other languages", () => {
    const found = foreign.filter(c => unsupportedLanguage(c.text, "ollama"))
    expect(found.length / foreign.length).toBeGreaterThanOrEqual(0.9)
  })

  it("is sure about scripts, and names the language", () => {
    expect(guessLanguage("你去死吧")).toEqual({ language: "zh", sure: true })
    expect(guessLanguage("잘 자, 내일 봐")).toMatchObject({ language: "ko", sure: true })
    expect(guessLanguage("du bist so hässlich und dumm")).toMatchObject({ language: "de", sure: true })
  })

  it("checks short Latin-script messages and mixed ones rather than guess", () => {
    expect(guessLanguage("vai se").sure).toBe(false)
    expect(unsupportedLanguage("ur so mid", "cloud")).toBeNull()
    expect(unsupportedLanguage("jom makan, I'm starving", "cloud")).toBeNull()
    expect(unsupportedLanguage("congrats on doing the bare minimum", "cloud")).toBeNull()
    expect(unsupportedLanguage("🙂🙂", "cloud")).toBeNull()
  })

  it("lets a backend check a language it's approved for", () => {
    expect(unsupportedLanguage("eres un inútil y nadie te quiere", "builtin")).toBe("es")
    APPROVED_LANGUAGES.builtin = ["en", "es"]
    try {
      expect(unsupportedLanguage("eres un inútil y nadie te quiere", "builtin")).toBeNull()
    } finally {
      APPROVED_LANGUAGES.builtin = ["en"]
    }
  })

  it("names the language on the badge", () => {
    expect(languageName("es")).toBe("Spanish")
    expect(languageName("unknown")).toBe("this language")
  })
})
