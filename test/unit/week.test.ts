import { describe, expect, it } from "vitest"
import { addToWeek, getWeek, recordWeek, weekLine, weekOf } from "../../src/settings/week"

const WED = new Date(2026, 10, 11, 15, 0)   // Wednesday 11 Nov 2026
const SUN = new Date(2026, 10, 15, 23, 0)   // same week
const MON = new Date(2026, 10, 16, 8, 0)    // the next week

describe("weekly tally", () => {
  it("weeks start on Monday", () => {
    expect(weekOf(WED)).toBe("2026-11-09")
    expect(weekOf(SUN)).toBe("2026-11-09")
    expect(weekOf(MON)).toBe("2026-11-16")
  })

  it("counts each flag and each suggestion taken once", () => {
    let s = addToWeek(undefined, "flagged", "e1", WED)
    s = addToWeek(s, "flagged", "e1", WED)   // re-written in another style: same event
    s = addToWeek(s, "flagged", "e2", WED)
    s = addToWeek(s, "accepted", "e1", SUN)
    expect(s).toMatchObject({ week: "2026-11-09", flagged: 2, accepted: 1 })
  })

  it("starts again each week", () => {
    const s = addToWeek(addToWeek(undefined, "flagged", "e1", WED), "flagged", "e2", MON)
    expect(s).toMatchObject({ week: "2026-11-16", flagged: 1, accepted: 0 })
  })

  it("says something encouraging", () => {
    expect(weekLine(undefined, WED)).toBe("This week: nothing flagged so far 🌱")
    const flagged = addToWeek(undefined, "flagged", "e1", WED)
    expect(weekLine(flagged, WED)).toContain("1 message flagged")
    const taken = addToWeek(addToWeek(flagged, "flagged", "e2", WED), "accepted", "e1", WED)
    expect(weekLine(taken, WED)).toBe("This week: you took 1 suggestion 🎉")
    expect(weekLine(addToWeek(taken, "accepted", "e2", WED), WED)).toBe("This week: you took 2 suggestions 🎉")
    // Last week's suggestions don't count now
    expect(weekLine(taken, MON)).toBe("This week: nothing flagged so far 🌱")
  })

  it("keeps the tally in storage, one write at a time", async () => {
    await Promise.all([recordWeek("flagged", "a"), recordWeek("flagged", "b"), recordWeek("accepted", "a")])
    expect(await getWeek()).toMatchObject({ flagged: 2, accepted: 1 })
  })
})
