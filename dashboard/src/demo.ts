// Made-up data for `?demo`, so the dashboard can be shown and checked
// without a Supabase project or a real child. Fixed, so it looks the same
// every time.
import type { Category, Platform, SharedEvent } from "./stats"

const CATEGORIES: Category[] = ["harsh_tone", "sarcasm", "insult", "dismissive", "mean_joke", "harsh_tone", "exclusion", "sarcasm"]
const PLATFORMS: Platform[]  = ["whatsapp", "whatsapp", "instagram", "whatsapp", "gmail", "instagram"]

export function demoEvents(now = new Date()): SharedEvent[] {
  const events: SharedEvent[] = []
  // Flags per week, oldest first: fewer over time, more suggestions taken
  const perWeek = [9, 11, 8, 10, 7, 8, 6, 7, 5, 6, 4, 3]
  perWeek.forEach((count, w) => {
    const weeksAgo = perWeek.length - 1 - w
    for (let i = 0; i < count; i++) {
      const n = w * 13 + i * 7
      const daysAgo = weeksAgo * 7 + (i % 5)
      events.push({
        tone: n % 5 === 0 ? "red" : "yellow",
        category: CATEGORIES[n % CATEGORIES.length],
        confidence: 0.7 + (n % 3) * 0.1,
        suggestion_accepted: (n + w) % 10 < 3 + w / 2 ? true : n % 4 === 0 ? null : false,
        platform: PLATFORMS[n % PLATFORMS.length],
        created_at: new Date(now.getTime() - daysAgo * 86_400_000 - (i % 3) * 3_600_000).toISOString(),
      })
    }
  })
  return events
}
