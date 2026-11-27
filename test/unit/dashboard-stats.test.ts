import { describe, expect, it } from "vitest"
import { breakdown, highlights, type SharedEvent, startOfWeek, weekly } from "../../dashboard/src/stats"

// Thursday 15 October 2026, local time
const NOW = new Date(2026, 9, 15, 12)

const ev = (daysAgo: number, tone: "yellow" | "red", accepted: boolean | null = null, extra: Partial<SharedEvent> = {}): SharedEvent => ({
  tone,
  category: "harsh_tone",
  confidence: 0.8,
  suggestion_accepted: accepted,
  platform: "whatsapp",
  created_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  ...extra,
})

describe("startOfWeek", () => {
  it("is Monday 00:00 of the same week, including on a Sunday", () => {
    expect(startOfWeek(NOW)).toEqual(new Date(2026, 9, 12))
    expect(startOfWeek(new Date(2026, 9, 18, 23))).toEqual(new Date(2026, 9, 12))
    expect(startOfWeek(new Date(2026, 9, 19, 0, 1))).toEqual(new Date(2026, 9, 19))
  })
})

describe("weekly", () => {
  it("counts yellow, red and suggestions taken per week, oldest first, empty weeks included", () => {
    const weeks = weekly([ev(0, "yellow", true), ev(1, "red", false), ev(7, "yellow", true), ev(200, "red")], NOW, 4)
    expect(weeks.map(w => w.start)).toEqual([new Date(2026, 8, 21), new Date(2026, 8, 28), new Date(2026, 9, 5), new Date(2026, 9, 12)])
    expect(weeks.map(w => [w.yellow, w.red, w.accepted])).toEqual([[0, 0, 0], [0, 0, 0], [1, 0, 1], [1, 1, 1]])
    expect(weeks.map(w => w.acceptRate)).toEqual([null, null, 1, 0.5])
  })
})

describe("breakdown", () => {
  it("counts per platform or category, most first, with readable labels", () => {
    const events = [ev(0, "yellow", null, { platform: "gmail" }), ev(0, "red"), ev(1, "red", null, { category: "sarcasm" })]
    expect(breakdown(events, "platform")).toEqual([
      { key: "whatsapp", label: "WhatsApp", count: 2 },
      { key: "gmail", label: "Gmail", count: 1 },
    ])
    expect(breakdown(events, "category").map(c => c.label)).toEqual(["Harsh tone", "Sarcasm"])
  })
})

describe("highlights", () => {
  it("puts good news first", () => {
    const weeks = weekly([ev(0, "yellow", true), ev(0, "red", true), ev(0, "yellow"), ev(7, "yellow"), ev(8, "yellow"), ev(9, "yellow"), ev(10, "red")], NOW, 2)
    expect(highlights(weeks)).toEqual([
      { kind: "good", text: "Took 2 of 3 suggestions this week." },
      { kind: "good", text: "1 fewer flagged message than last week." },
      { kind: "watch", text: "1 message was flagged red (unkind) this week — maybe worth a gentle chat." },
    ])
  })

  it("says so when nothing was flagged", () => {
    const weeks = weekly([ev(8, "red")], NOW, 2)
    expect(highlights(weeks).map(h => h.text)).toEqual([
      "No messages flagged this week.",
      "1 fewer flagged message than last week.",
      "No red flags this week, after some last week.",
    ])
  })

  it("is plain, not alarming, when fewer suggestions were taken and flags went up", () => {
    const weeks = weekly([ev(0, "yellow", false), ev(0, "yellow", null)], NOW, 2)
    expect(highlights(weeks)).toEqual([
      { kind: "neutral", text: "Took 0 of 2 suggestions this week." },
      { kind: "watch", text: "2 more flagged messages than last week." },
    ])
  })
})
