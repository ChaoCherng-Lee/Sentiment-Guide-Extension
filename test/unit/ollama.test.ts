import { describe, expect, it } from "vitest"
import { pickModel, pullProgress } from "../../src/analysis/ollama"

describe("pickModel", () => {
  it("prefers the user's choice when installed", () => {
    expect(pickModel(["gemma3:4b", "llama3"], "llama3")).toBe("llama3")
  })

  it("ignores a choice that isn't installed", () => {
    expect(pickModel(["gemma3:4b"], "llama3")).toBe("gemma3:4b")
  })

  it("falls back through gemma versions", () => {
    expect(pickModel(["gemma3:12b", "gemma2"], null)).toBe("gemma3:12b")
    expect(pickModel(["gemma2:2b"], null)).toBe("gemma2:2b")
    expect(pickModel(["llama3"], null)).toBeNull()
  })
})

describe("pullProgress", () => {
  it("adds up every layer, using each layer's latest report", () => {
    expect(pullProgress([
      { status: "pulling manifest" },
      { status: "pulling a", digest: "a", total: 3000, completed: 0 },
      { status: "pulling a", digest: "a", total: 3000, completed: 1500 },
      { status: "pulling b", digest: "b", total: 1000, completed: 1000 },
      { status: "pulling a", digest: "a", total: 3000, completed: 2000 },
    ])).toEqual({ completed: 3000, total: 4000 })
  })

  it("is empty before any layer reports a size, and never goes past the total", () => {
    expect(pullProgress([{ status: "pulling manifest" }])).toEqual({ completed: 0, total: 0 })
    expect(pullProgress([{ status: "x", digest: "a", total: 10, completed: 12 }])).toEqual({ completed: 10, total: 10 })
  })
})
