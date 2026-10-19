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
// - Nothing is uploaded until the child has paired.
//
// Plain fetch against Supabase's REST and Auth APIs — no SDK in the worker.
// =============================================================================

import { browser } from "#imports"
import type { ChatContext } from "../analysis/types"
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
// Uploads — only once paired; failures are logged and dropped (5.2 queues them)
// -----------------------------------------------------------------------------

async function upload(method: "POST" | "PATCH", path: string, body: unknown, headers?: Record<string, string>) {
  if (!(await isPaired())) return
  try {
    await request(method, path, body, headers)
  } catch (err) {
    console.log("Sentiment Guide bg:", (err as Error).message)
  }
}

export interface ToneEvent {
  id: string
  contact_hash: string | null
  tone: "yellow" | "red"
  confidence: number
  label: string
  flagged_phrase: string
  suggestion: string
  tone_tags_detected: boolean
}

export async function logEvent(event: ToneEvent) {
  // child_id is filled in by the database from the signed-in account
  await upload("POST", "events", { ...event, suggestion_accepted: null })
}

export async function logAcceptance(eventId: string, accepted: boolean) {
  await upload("PATCH", `events?id=eq.${encodeURIComponent(eventId)}`, { suggestion_accepted: accepted })
}

export async function logContext(context: ChatContext, contactHash: string) {
  await upload("POST", "context_forms?on_conflict=child_id,contact_hash", {
    contact_hash:             contactHash,
    platform:                 context.platform,
    relationship:             context.q1,
    communication_style:      context.q2,
    child_uses_tone_tags:     context.q3,
    recipient_uses_tone_tags: context.q4,
    conversation_mood:        context.q5,
    saved_at:                 new Date(context.savedAt).toISOString(),
  }, { Prefer: "resolution=merge-duplicates" })
}
