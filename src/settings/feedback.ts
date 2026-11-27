// "It's fine" feedback (Plan 7.3): when the user says a flagged message was
// fine, and optionally why. Kept in storage.local on this computer only, as
// counts; it's the live signal for wrong flags (Spec §8: "It's fine" on red
// cards). Never uploaded, and not part of parent sharing.

import { browser } from "#imports"

export const FINE_REASONS = ["joke", "knows_me", "accurate", "other"] as const
export type FineReason = (typeof FINE_REASONS)[number]

/** What the card says for each reason */
export const FINE_REASON_LABELS: Record<FineReason, string> = {
  joke:     "A joke between us",
  knows_me: "They know what I mean",
  accurate: "It's true and needs saying",
  other:    "Something else",
}

export interface FineStats {
  /** Messages marked fine, by the colour they were flagged */
  byTone: { yellow: number; red: number }
  /** Reasons given; "none" when the user didn't pick one */
  byReason: Record<FineReason | "none", number>
}

const KEY = "fineFeedback"

export function emptyFineStats(): FineStats {
  return { byTone: { yellow: 0, red: 0 }, byReason: { joke: 0, knows_me: 0, accurate: 0, other: 0, none: 0 } }
}

export function addFine(stats: FineStats | undefined, tone: "yellow" | "red", reason: FineReason | null): FineStats {
  const base = emptyFineStats()
  const s: FineStats = {
    byTone:   { ...base.byTone, ...stats?.byTone },
    byReason: { ...base.byReason, ...stats?.byReason },
  }
  s.byTone[tone]++
  s.byReason[reason ?? "none"]++
  return s
}

let writing: Promise<unknown> = Promise.resolve()

/** Record in storage. Called by the background worker only, one write at a time. */
export function recordFine(tone: "yellow" | "red", reason: FineReason | null): Promise<void> {
  const next = writing.then(async () => {
    const stats = (await browser.storage.local.get(KEY))[KEY] as FineStats | undefined
    await browser.storage.local.set({ [KEY]: addFine(stats, tone, reason) })
  })
  writing = next.catch(() => {})
  return next
}

export async function getFineStats(): Promise<FineStats> {
  return ((await browser.storage.local.get(KEY))[KEY] as FineStats | undefined) ?? emptyFineStats()
}
