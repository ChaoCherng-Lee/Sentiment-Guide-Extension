import { describe, expect, it } from "vitest"
import {
  addExample, FINE_EXAMPLE_MAX_CHARS, FINE_EXAMPLES_PER_SCOPE, type FineExamples, similarExamples, similarity,
} from "../../src/settings/fine-examples"

describe("learning from It's fine", () => {
  it("keeps the newest 50 per chat, without repeats, each cut short", () => {
    let all: FineExamples = {}
    for (let i = 0; i < FINE_EXAMPLES_PER_SCOPE + 10; i++) all = addExample(all, "chat-a", `message number ${i}`, i)
    expect(all["chat-a"]).toHaveLength(FINE_EXAMPLES_PER_SCOPE)
    expect(all["chat-a"][0].text).toBe(`message number ${FINE_EXAMPLES_PER_SCOPE + 9}`)

    all = addExample(all, "chat-a", "MESSAGE NUMBER 20", 999)
    expect(all["chat-a"].filter(e => e.text.toLowerCase() === "message number 20")).toHaveLength(1)
    expect(all["chat-a"][0].at).toBe(999)

    all = addExample(all, "chat-b", "x".repeat(500))
    expect(all["chat-b"][0].text).toHaveLength(FINE_EXAMPLE_MAX_CHARS)
    expect(all["chat-a"]).toHaveLength(FINE_EXAMPLES_PER_SCOPE)   // chats are kept apart
    expect(addExample(all, "chat-c", "   ")).toBe(all)
  })

  it("scores similar messages higher than different ones", () => {
    expect(similarity("you absolute clown 🤡", "you absolute clown 🤡")).toBe(1)
    expect(similarity("you absolute clown 🤡", "you total clown lol")).toBeGreaterThan(similarity("you absolute clown 🤡", "see you at five"))
    expect(similarity("", "hi")).toBe(0)
  })

  it("finds the 3 most similar, and only ones that are actually alike", () => {
    let all: FineExamples = {}
    for (const t of ["shut up you clown", "you clown 😂", "clown behaviour honestly", "you're such a clown lol", "see you at 5", "can you send the file"]) {
      all = addExample(all, "chat", t)
    }
    const found = similarExamples(all.chat, "you're a clown lol")
    expect(found).toHaveLength(3)
    expect(found[0].text).toBe("you're such a clown lol")
    expect(found.map(f => f.text)).not.toContain("can you send the file")
    expect(similarExamples(all.chat, "the meeting moved to Thursday")).toEqual([])
  })
})
