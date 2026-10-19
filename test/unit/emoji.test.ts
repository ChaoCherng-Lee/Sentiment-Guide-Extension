import { describe, expect, it } from "vitest"
import { emojiNotesFor, emojiReading, findEmoji, graphemeLength, hasWords } from "../../src/analysis/emoji"
import { worthChecking } from "../../src/engine/compose-session"

const FACEPALM = "🤦\u200D♀\uFE0F"   // woman facepalming: base + ZWJ + sign + VS16
const THUMBS   = "👍🏽"                  // thumbs up + skin tone

describe("graphemeLength", () => {
  it("counts emoji as one character each, however they are built", () => {
    expect("🙄".length).toBe(2)
    expect(graphemeLength("🙄")).toBe(1)
    expect(graphemeLength(THUMBS)).toBe(1)
    expect(graphemeLength(FACEPALM)).toBe(1)
    expect(graphemeLength("ok 👍🏽")).toBe(4)
  })
})

describe("findEmoji", () => {
  it("finds every emoji in order, keeping skin tones and ZWJ sequences whole", () => {
    expect(findEmoji(`ugh ${FACEPALM} fine ${THUMBS}${THUMBS}`)).toEqual([FACEPALM, THUMBS, THUMBS])
    expect(findEmoji("no emoji here")).toEqual([])
  })
})

describe("emoji lexicon", () => {
  it("looks emoji up regardless of skin tone, variation selector or gender", () => {
    expect(emojiReading("👍")?.lean).toBe("friendly")
    expect(emojiReading("🙄")?.lean).toBe("negative")
    expect(emojiReading(THUMBS)).toEqual(emojiReading("👍"))
    expect(emojiReading("❤\uFE0F")).toBe(emojiReading("❤"))
    expect(emojiReading(FACEPALM)).toBe(emojiReading("🤦"))
    expect(emojiReading("🦒")).toBeNull()
  })

  it("gives one note per distinct emoji in the message, and none for unknown ones", () => {
    const notes = emojiNotesFor("lol 💀💀 ok 🙂 🦒")
    expect(notes.map(n => n.emoji)).toEqual(["💀", "🙂"])
    expect(notes[0].reading).toMatch(/laughing/)
  })
})

describe("hasWords", () => {
  it("tells emoji-only text apart from text with words", () => {
    expect(hasWords("🙄 🙄")).toBe(false)
    expect(hasWords("sure 🙄")).toBe(true)
  })
})

describe("worthChecking", () => {
  it("checks a single emoji, but not one or two plain characters", () => {
    expect(worthChecking("🙄")).toBe(true)
    expect(worthChecking(THUMBS)).toBe(true)
    expect(worthChecking("ok")).toBe(false)
    expect(worthChecking("k.")).toBe(false)
    expect(worthChecking("idk")).toBe(true)
  })
})
