import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { RELEASES } from "../../src/whats-new"

describe("What's new", () => {
  it("has notes for the version being built, newest first", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
    expect(RELEASES[0].version).toBe(version)
    expect(RELEASES[0].items.length).toBeGreaterThan(0)
  })
})
