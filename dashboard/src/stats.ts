// Turns a child's shared events into what the dashboard shows. Pure
// functions: no Supabase, no React, so they're easy to test.
//
// An event has no text in it at all — only tone, category, confidence,
// whether the suggestion was taken, the app and the time (Plan 5.2).

export type Tone = "yellow" | "red"
export type Platform = "whatsapp" | "instagram" | "gmail" | "web"
export type Category = "insult" | "mean_joke" | "sarcasm" | "dismissive" | "harsh_tone" | "threat" | "exclusion" | "other"

export interface SharedEvent {
  tone: Tone
  category: Category
  confidence: number
  /** true = took the suggestion, false = dismissed it, null = closed without choosing */
  suggestion_accepted: boolean | null
  platform: Platform
  created_at: string
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  gmail: "Gmail",
  web: "Other websites",
}

export const CATEGORY_LABELS: Record<Category, string> = {
  insult: "Insults",
  mean_joke: "Jokes that could hurt",
  sarcasm: "Sarcasm",
  dismissive: "Dismissive",
  harsh_tone: "Harsh tone",
  threat: "Threats",
  exclusion: "Leaving someone out",
  other: "Other",
}

/** Monday 00:00 (local time) of the week `d` falls in. */
export function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const back = (s.getDay() + 6) % 7   // days since Monday
  s.setDate(s.getDate() - back)
  return s
}

export interface Week {
  start: Date
  yellow: number
  red: number
  total: number
  /** Suggestions taken */
  accepted: number
  /** Share of flagged messages where the suggestion was taken; null for a week with none */
  acceptRate: number | null
}

/** The last `weeks` weeks up to and including the one `now` is in, oldest first. */
export function weekly(events: SharedEvent[], now: Date, weeks = 12): Week[] {
  const thisWeek = startOfWeek(now)
  const out: Week[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek)
    start.setDate(start.getDate() - 7 * i)
    out.push({ start, yellow: 0, red: 0, total: 0, accepted: 0, acceptRate: null })
  }
  for (const e of events) {
    const t = new Date(e.created_at).getTime()
    const week = out.find(w => t >= w.start.getTime() && t < nextStart(w).getTime())
    if (!week) continue
    week[e.tone]++
    week.total++
    if (e.suggestion_accepted === true) week.accepted++
  }
  for (const w of out) w.acceptRate = w.total ? w.accepted / w.total : null
  return out
}

/** The next Monday after a week's start (handles daylight-saving changes). */
function nextStart(w: Week): Date {
  const n = new Date(w.start)
  n.setDate(n.getDate() + 7)
  return n
}

export interface Count<K extends string> {
  key: K
  label: string
  count: number
}

/** How many events per platform or category, most first; only keys that occur. */
export function breakdown<K extends "platform" | "category">(
  events: SharedEvent[],
  key: K,
): Count<SharedEvent[K]>[] {
  const labels = (key === "platform" ? PLATFORM_LABELS : CATEGORY_LABELS) as Record<SharedEvent[K], string>
  const counts = new Map<SharedEvent[K], number>()
  for (const e of events) counts.set(e[key], (counts.get(e[key]) ?? 0) + 1)
  return [...counts]
    .map(([k, count]) => ({ key: k, label: labels[k] ?? k, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export interface Highlight {
  /** good news first, then neutral, then things worth a chat */
  kind: "good" | "neutral" | "watch"
  text: string
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`

/**
 * A few plain sentences about this week compared with last, positive ones
 * first — the dashboard is for coaching, not surveillance.
 */
export function highlights(weeks: Week[]): Highlight[] {
  const now  = weeks.at(-1)
  const prev = weeks.at(-2)
  if (!now) return []
  const out: Highlight[] = []

  if (now.total === 0) {
    out.push({ kind: "good", text: "No messages flagged this week." })
  } else if (now.acceptRate !== null && now.acceptRate >= 0.5) {
    out.push({ kind: "good", text: `Took ${now.accepted} of ${plural(now.total, "suggestion")} this week.` })
  } else {
    out.push({ kind: "neutral", text: `Took ${now.accepted} of ${plural(now.total, "suggestion")} this week.` })
  }

  if (prev) {
    const diff = now.total - prev.total
    if (diff < 0) out.push({ kind: "good", text: `${plural(-diff, "fewer flagged message", "fewer flagged messages")} than last week.` })
    if (now.red === 0 && prev.red > 0) out.push({ kind: "good", text: "No red flags this week, after some last week." })
    if (diff > 0) out.push({ kind: "watch", text: `${plural(diff, "more flagged message", "more flagged messages")} than last week.` })
  }
  if (now.red > 0) {
    out.push({ kind: "watch", text: `${plural(now.red, "message was", "messages were")} flagged red (unkind) this week — maybe worth a gentle chat.` })
  }

  const order = { good: 0, neutral: 1, watch: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind])
}
