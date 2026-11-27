import { describe, expect, it } from "vitest"
import { addFine, emptyFineStats, getFineStats, recordFine } from "../../src/settings/feedback"
import { addToWeek } from "../../src/settings/week"

describe("'It's fine' feedback", () => {
  it("counts by the colour flagged and by the reason given", () => {
    let s = addFine(undefined, "red", "joke")
    s = addFine(s, "yellow", null)
    s = addFine(s, "red", "joke")
    expect(s.byTone).toEqual({ yellow: 1, red: 2 })
    expect(s.byReason).toEqual({ joke: 2, knows_me: 0, accurate: 0, other: 0, none: 1 })
  })

  it("is stored on this computer, one write at a time", async () => {
    await Promise.all([recordFine("red", "accurate"), recordFine("yellow", "other")])
    const s = await getFineStats()
    expect(s.byTone).toEqual({ yellow: 1, red: 1 })
    expect(s.byReason.accurate).toBe(1)
    expect(s.byReason.other).toBe(1)
  })

  it("starts empty", () => {
    expect(emptyFineStats().byTone).toEqual({ yellow: 0, red: 0 })
  })

  it("is counted in the week, once per message, even in a tally from before", () => {
    const old = { week: "2026-11-09", flagged: 3, accepted: 1, ids: [] }   // no "fine" yet
    const wed = new Date(2026, 10, 11)
    let s = addToWeek(old, "fine", "e1", wed)
    s = addToWeek(s, "fine", "e1", wed)
    expect(s.fine).toBe(1)
  })
})
