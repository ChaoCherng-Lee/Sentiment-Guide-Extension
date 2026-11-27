// Opt-in diagnostics (Plan 12.2, Spec NFR-6). Off by default.
//
// When on: counts per day — checks, flags by tone, accepted, "It's fine" by
// reason, failures by kind, how long checks took (in buckets), which AI is
// used, the kind of site (chat / email / other) — and "adapter broken"
// reports. Never message text, never site names, nothing that identifies
// the person. Kept on this computer and sent once a day.

import { browser } from "#imports"
import type { BackendId } from "./analysis/backend"

const KEY = "diagnostics"
/** Days kept on this computer if they can't be sent (then the oldest go) */
const MAX_DAYS = 7
/** Upper edges of the latency buckets, in ms */
export const LATENCY_BUCKETS = [500, 1000, 1500, 3000, 6000, Infinity]

export type SiteKind = "chat" | "email" | "web"

/** The kind of site only: WhatsApp and Instagram are chats, Gmail is email, anything else "web" */
export function siteKind(platform: string): SiteKind {
  return platform === "whatsapp" || platform === "instagram" ? "chat" : platform === "gmail" ? "email" : "web"
}

export type DiagEvent =
  | { kind: "check"; backend: BackendId; ms: number }
  | { kind: "flag"; tone: "yellow" | "red"; site: SiteKind }
  | { kind: "accepted" }
  | { kind: "fine"; reason: string | null }
  | { kind: "failure"; reason: string }
  | { kind: "adapter-broken"; adapter: string }

/** One day's counts: flat names → numbers, e.g. "flag.red.chat": 3 */
export interface DiagDay {
  day: string
  counts: Record<string, number>
}

/** Turns an event into the counter names it adds one to. Only fixed words go in a name. */
export function counterNames(e: DiagEvent): string[] {
  const word = (s: string) => s.replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "other"
  switch (e.kind) {
    case "check": {
      const bucket = LATENCY_BUCKETS.findIndex(edge => e.ms <= edge)
      const label  = LATENCY_BUCKETS[bucket] === Infinity ? "more" : String(LATENCY_BUCKETS[bucket])
      return [`check.${word(e.backend)}`, `latency.${label}`]
    }
    case "flag":           return [`flag.${e.tone}.${e.site}`]
    case "accepted":       return ["accepted"]
    case "fine":           return [`fine.${e.reason ? word(e.reason) : "none"}`]
    case "failure":        return [`failure.${word(e.reason)}`]
    case "adapter-broken": return [`adapter-broken.${word(e.adapter)}`]
  }
}

const today = () => new Date().toISOString().slice(0, 10)

async function load(): Promise<DiagDay[]> {
  return ((await browser.storage.local.get(KEY))[KEY] as DiagDay[] | undefined) ?? []
}

/** Adds one event to today's counts. Call only when diagnostics are on. */
export async function recordDiag(e: DiagEvent) {
  const days = await load()
  let day = days.find(d => d.day === today())
  if (!day) { day = { day: today(), counts: {} }; days.push(day) }
  for (const name of counterNames(e)) day.counts[name] = (day.counts[name] ?? 0) + 1
  await browser.storage.local.set({ [KEY]: days.slice(-MAX_DAYS) })
}

export async function pendingDiag(): Promise<DiagDay[]> {
  return load()
}

export async function forgetDiag() {
  await browser.storage.local.remove(KEY)
}

/**
 * Sends the finished days (not today's, still counting) and forgets them.
 * `send` posts one day; a failure keeps the day for the next try.
 */
export async function flushDiag(send: (day: DiagDay) => Promise<boolean>) {
  const days = await load()
  const keep: DiagDay[] = []
  for (const d of days) {
    if (d.day === today() || !(await send(d))) keep.push(d)
  }
  await browser.storage.local.set({ [KEY]: keep })
}

const SUPABASE_URL      = (import.meta.env.WXT_SUPABASE_URL as string | undefined) ?? ""
const SUPABASE_ANON_KEY = (import.meta.env.WXT_SUPABASE_ANON_KEY as string | undefined) ?? ""

/** Posts one day of counts to the diagnostics table, with the public key only (no sign-in). */
export async function sendDiagDay(day: DiagDay, edition: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/diagnostics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The key alone makes the request "anon" (newer sb_publishable_ keys aren't JWTs,
        // so they don't go in Authorization)
        apikey:         SUPABASE_ANON_KEY,
        Prefer:         "return=minimal",
      },
      body: JSON.stringify({ day: day.day, edition, version: browser.runtime.getManifest().version, counts: day.counts }),
    })
    return res.ok
  } catch {
    return false
  }
}
