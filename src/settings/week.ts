// "Your week" — a small, private tally the toolbar popup turns into an
// encouraging line: how many messages were flagged this week and how many
// suggestions were taken. Kept in storage.local on this computer only; it is
// separate from parent sharing and never uploaded.

import { browser } from "#imports"

export interface WeekStats {
  /** Monday the week started, "YYYY-MM-DD" (local time) */
  week: string
  flagged: number
  accepted: number
  /** Flagged messages the user said were fine (missing in tallies from before 7.3) */
  fine?: number
  /** Events already counted, so a re-written suggestion isn't counted twice */
  ids: string[]
}

const KEY = "weekStats"
const MAX_IDS = 200

/** Monday of the week `now` falls in, as "YYYY-MM-DD". */
export function weekOf(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** This week's tally: last week's numbers don't carry over. */
export function current(stats: WeekStats | undefined, now: Date): WeekStats {
  const week = weekOf(now)
  return stats?.week === week ? stats : { week, flagged: 0, accepted: 0, fine: 0, ids: [] }
}

export type WeekKind = "flagged" | "accepted" | "fine"

/** Count one flagged message, one suggestion taken, or one "It's fine", once per event. */
export function addToWeek(stats: WeekStats | undefined, kind: WeekKind, eventId: string, now: Date): WeekStats {
  const s   = current(stats, now)
  const key = `${kind}:${eventId}`
  if (s.ids.includes(key)) return s
  return { ...s, [kind]: (s[kind] ?? 0) + 1, ids: [...s.ids, key].slice(-MAX_IDS) }
}

/** The line shown in the toolbar popup. */
export function weekLine(stats: WeekStats | undefined, now: Date): string {
  const { flagged, accepted } = current(stats, now)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  if (accepted > 0) return `This week: you took ${plural(accepted, "suggestion")} 🎉`
  if (flagged > 0)  return `This week: ${plural(flagged, "message")} flagged — a suggestion is one click away`
  return "This week: nothing flagged so far 🌱"
}

let writing: Promise<unknown> = Promise.resolve()

/** Record in storage. Called by the background worker only, one write at a time. */
export function recordWeek(kind: WeekKind, eventId: string): Promise<void> {
  const next = writing.then(async () => {
    const stats = (await browser.storage.local.get(KEY))[KEY] as WeekStats | undefined
    await browser.storage.local.set({ [KEY]: addToWeek(stats, kind, eventId, new Date()) })
  })
  writing = next.catch(() => {})
  return next
}

export async function getWeek(): Promise<WeekStats | undefined> {
  return (await browser.storage.local.get(KEY))[KEY] as WeekStats | undefined
}
