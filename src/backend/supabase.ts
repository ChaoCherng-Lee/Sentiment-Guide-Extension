// =============================================================================
// Supabase (OPTIONAL) — only for sharing with a parent's dashboard. The
// extension works fully without it.
//
// - Configured at build time (WXT_SUPABASE_URL / WXT_SUPABASE_ANON_KEY in
//   .env — see .env.example). With no config, nothing is ever sent.
// - The child's extension signs in anonymously; a parent's pairing code links
//   the two accounts (supabase/migrations/…_auth_pairing_rls.sql). The anon
//   key is safe to ship only because the database rules restrict every row
//   to its owner and their linked parents.
// - Nothing is uploaded until the child has agreed and paired.
//
// Plain fetch against Supabase's REST and Auth APIs — no SDK in the worker.
// =============================================================================

import { browser } from "#imports"
import type { FlagCategory } from "../analysis/types"
import type { PairResult } from "../messaging"

const SUPABASE_URL      = (import.meta.env.WXT_SUPABASE_URL as string | undefined) ?? ""
const SUPABASE_ANON_KEY = (import.meta.env.WXT_SUPABASE_ANON_KEY as string | undefined) ?? ""

export function supabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY
}

// -----------------------------------------------------------------------------
// Session — an anonymous account for this browser, kept in storage.local
// -----------------------------------------------------------------------------

interface Session {
  access_token: string
  refresh_token: string
  /** ms since epoch */
  expires_at: number
  user_id: string
}

const SESSION_KEY = "sb_session"
const PAIRED_KEY  = "sb_paired"

interface AuthResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string }
}

async function auth(path: string, body: unknown): Promise<Session> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase auth ${path} failed (${res.status})`)
  const data = await res.json() as AuthResponse
  const session: Session = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    Date.now() + data.expires_in * 1000,
    user_id:       data.user.id,
  }
  await browser.storage.local.set({ [SESSION_KEY]: session })
  return session
}

let refreshing: Promise<Session> | null = null

/** A valid session: the stored one, refreshed if it's about to expire, or a new anonymous one. */
async function session(): Promise<Session> {
  const stored = (await browser.storage.local.get(SESSION_KEY))[SESSION_KEY] as Session | undefined
  if (stored && stored.expires_at - Date.now() > 60_000) return stored
  refreshing ??= (stored
    ? auth("token?grant_type=refresh_token", { refresh_token: stored.refresh_token })
    : auth("signup", {})   // anonymous sign-in
  ).finally(() => { refreshing = null })
  return refreshing
}

async function request(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}) {
  const s = await session()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey:         SUPABASE_ANON_KEY,
      Authorization:  `Bearer ${s.access_token}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed (${res.status})`)
  return res.status === 204 ? null : res.json().catch(() => null)
}

// -----------------------------------------------------------------------------
// Pairing
// -----------------------------------------------------------------------------

/** Use a parent's 6-digit pairing code. */
export async function pairWithCode(code: string): Promise<PairResult> {
  if (!supabaseConfigured()) return "not_configured"
  if (!/^\d{6}$/.test(code)) return "invalid"
  try {
    const result = await request("POST", "rpc/redeem_pairing_code", { p_code: code }) as PairResult
    if (result === "ok") await browser.storage.local.set({ [PAIRED_KEY]: true })
    return result
  } catch (err) {
    console.log("Sentiment Guide bg: pairing failed —", (err as Error).message)
    return "error"
  }
}

export async function isPaired(): Promise<boolean> {
  return supabaseConfigured() && (await browser.storage.local.get(PAIRED_KEY))[PAIRED_KEY] === true
}

// -----------------------------------------------------------------------------
// Uploads (Plan 5.2) — only once paired, never while paused, and only what the
// dashboard needs: tone, a category from a fixed list, confidence, whether
// the suggestion was taken, the platform and the time. No text, no contact.
// Failed uploads wait in a queue in storage.local and are retried.
// -----------------------------------------------------------------------------

/** One flagged message, as a parent's dashboard sees it. */
export interface SharedEvent {
  id: string
  tone: "yellow" | "red"
  category: FlagCategory
  confidence: number
  platform: "whatsapp" | "instagram" | "gmail"
}

type QueuedUpload =
  | { op: "insert"; row: SharedEvent & { suggestion_accepted: boolean | null; created_at: string } }
  | { op: "accept"; id: string; accepted: boolean }

const QUEUE_KEY = "sb_queue"
/** A child offline for weeks shouldn't fill storage — oldest uploads go first */
const MAX_QUEUE = 500

async function readQueue(): Promise<QueuedUpload[]> {
  return ((await browser.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as QueuedUpload[] | undefined) ?? []
}

async function enqueue(item: QueuedUpload) {
  const queue = await readQueue()
  // Accepting an event that is still waiting to go: send it with the answer
  const waiting = item.op === "accept" && queue.find(q => q.op === "insert" && q.row.id === item.id)
  if (waiting && waiting.op === "insert" && item.op === "accept") waiting.row.suggestion_accepted = item.accepted
  else queue.push(item)
  await browser.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) })
}

let flushing: Promise<void> | null = null

/**
 * Send queued uploads in order; stop at the first failure and keep the rest
 * for the next try. `allowed` is false while the extension is off or paused.
 */
export function flushUploads(allowed: boolean): Promise<void> {
  flushing ??= (async () => {
    if (!allowed || !(await isPaired())) return
    let queue = await readQueue()
    while (queue.length) {
      const item = queue[0]
      try {
        if (item.op === "insert") {
          // Upsert, so a retry after a lost response doesn't fail on the same id
          await request("POST", "events?on_conflict=id", item.row, { Prefer: "resolution=merge-duplicates" })
        } else {
          await request("PATCH", `events?id=eq.${encodeURIComponent(item.id)}`, { suggestion_accepted: item.accepted })
        }
      } catch (err) {
        console.log("Sentiment Guide bg: upload will be retried —", (err as Error).message)
        return
      }
      queue = (await readQueue()).slice(1)
      await browser.storage.local.set({ [QUEUE_KEY]: queue })
    }
  })().finally(() => { flushing = null })
  return flushing
}

export async function logEvent(event: SharedEvent, allowed: boolean) {
  if (!(await isPaired())) return
  // child_id is filled in by the database from the signed-in account
  await enqueue({ op: "insert", row: { ...event, suggestion_accepted: null, created_at: new Date().toISOString() } })
  await flushUploads(allowed)
}

export async function logAcceptance(eventId: string, accepted: boolean, allowed: boolean) {
  if (!(await isPaired())) return
  await enqueue({ op: "accept", id: eventId, accepted })
  await flushUploads(allowed)
}

/**
 * "Unlink and delete my data": deletes this child's events and links on the
 * server, then forgets the account and anything still queued here.
 */
export async function unlinkAndDelete(): Promise<boolean> {
  if (!supabaseConfigured()) return false
  try {
    await request("POST", "rpc/delete_my_data", {})
  } catch (err) {
    console.log("Sentiment Guide bg: delete failed —", (err as Error).message)
    return false
  }
  await browser.storage.local.remove([SESSION_KEY, PAIRED_KEY, QUEUE_KEY])
  return true
}
