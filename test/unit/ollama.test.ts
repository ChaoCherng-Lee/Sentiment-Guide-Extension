import { describe, expect, it } from "vitest"
import { pickModel } from "../../src/analysis/ollama"

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
