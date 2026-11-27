// =============================================================================
// The private cloud check (Plan 8.3, Spec FR-4.3, NFR-4/5): a Supabase Edge
// Function that asks a hosted model the same questions the extension asks a
// local one, and forgets the message straight away.
//
//   GET  /tone-check            → { ok: true }               (health)
//   POST /tone-check/register   → { token }                  (one per install)
//   POST /tone-check            → { result }                 (one check)
//        header x-install-token, body { task, text, context?, style?, verdict? }
//
// Never written down: message text, context, the model's answer. Logs carry
// the task, status and timing only. The prompts are built here, from a copy
// of the extension's own (../_shared/analysis), so nobody can use the
// endpoint as a general-purpose model, and chat context (other people's
// messages) is never accepted.
//
// Pure functions of a Request so they run in Deno and in the unit tests.
// =============================================================================

import { buildAdviceMessages, buildIncomingMessages, buildVerdictMessages, type ChatTurn } from "../_shared/analysis/prompts.ts"
import { ADVICE_SCHEMA, INCOMING_SCHEMA, VERDICT_SCHEMA } from "../_shared/analysis/schema.ts"
import type { ChatContext, Sensitivity, SuggestionStyle, ToneVerdict } from "../_shared/analysis/types.ts"

export type Task = "verdict" | "advice" | "incoming"

export interface Deps {
  /** Secret that signs install tokens (env TONE_TOKEN_SECRET) */
  secret: string
  /** Ask the model; answers with JSON matching `schema` */
  callModel(messages: ChatTurn[], schema: object, signal: AbortSignal): Promise<unknown>
  /** Count one hit against `key` this hour; false once over `max` */
  rateHit(key: string, max: number): Promise<boolean>
  log?(line: Record<string, unknown>): void
}

/** Checks per install per hour (Spec NFR-5) */
export const CHECKS_PER_HOUR = 300
/** New installs per network address per hour */
export const REGISTRATIONS_PER_HOUR = 20
export const MAX_TEXT = 2000
const MODEL_TIMEOUT_MS = 20_000

const STYLES: SuggestionStyle[] = ["casual", "formal", "direct"]
const SENSITIVITIES: Sensitivity[] = ["gentle", "balanced", "strict"]
const TONES = ["green", "yellow", "red"]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

// ── Install tokens: "<id>.<signature>", no database needed to check one ─────

const enc = new TextEncoder()

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ""
  for (const byte of b) s += String.fromCharCode(byte)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)))
}

export async function newToken(secret: string): Promise<string> {
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)))
  return `${id}.${await sign(secret, id)}`
}

/** The install id in a genuine token, else null. */
export async function tokenId(secret: string, token: string | null): Promise<string | null> {
  const [id, sig, extra] = (token ?? "").split(".")
  if (!id || !sig || extra !== undefined) return null
  const good = await sign(secret, id)
  // Same length, compare every character (no early exit)
  if (good.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0 ? id : null
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** Only the fields the prompts use, as strings; anything else is dropped. */
function cleanContext(raw: unknown): ChatContext | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : "")
  return {
    platform: "whatsapp", savedAt: 0,
    q1: str(r.q1), q2: str(r.q2), q3: str(r.q3), q4: str(r.q4), q5: str(r.q5),
  } as ChatContext
}

function cleanVerdict(raw: unknown, text: string): ToneVerdict | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (!TONES.includes(r.tone as string)) return null
  const phrase = typeof r.flagged_phrase === "string" && text.includes(r.flagged_phrase) ? r.flagged_phrase : ""
  return {
    tone: r.tone as ToneVerdict["tone"],
    confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
    flagged_phrase: phrase,
  }
}

type Built = { messages: ChatTurn[]; schema: object } | { error: string }

export function buildTask(body: Record<string, unknown>): Built {
  const text = typeof body.text === "string" ? body.text : ""
  if (!text.trim()) return { error: "text is required" }
  if (text.length > MAX_TEXT) return { error: `text is longer than ${MAX_TEXT} characters` }
  const context = cleanContext(body.context)
  switch (body.task) {
    case "verdict":
      // No chat context, ever: other people's messages stay on the computer
      return {
        messages: buildVerdictMessages(text, context, [],
          SENSITIVITIES.includes(body.sensitivity as Sensitivity) ? body.sensitivity as Sensitivity : "balanced"),
        schema: VERDICT_SCHEMA,
      }
    case "advice": {
      const verdict = cleanVerdict(body.verdict, text)
      if (!verdict) return { error: "verdict is required" }
      const style = STYLES.includes(body.style as SuggestionStyle) ? body.style as SuggestionStyle : "casual"
      return { messages: buildAdviceMessages(text, verdict, context, style, []), schema: ADVICE_SCHEMA }
    }
    case "incoming":
      return { messages: buildIncomingMessages(text), schema: INCOMING_SCHEMA }
    default:
      return { error: "task must be verdict, advice or incoming" }
  }
}

/** A short, one-way name for a network address, so it can be rate-limited without being stored. */
async function addressKey(secret: string, req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown"
  return "r:" + (await sign(secret, "ip:" + ip)).slice(0, 22)
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const started = Date.now()
  const log = (line: Record<string, unknown>) => deps.log?.({ ...line, ms: Date.now() - started })
  const path = new URL(req.url).pathname.replace(/\/+$/, "")

  if (req.method === "GET") return json({ ok: true })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  if (path.endsWith("/register")) {
    if (!(await deps.rateHit(await addressKey(deps.secret, req), REGISTRATIONS_PER_HOUR))) {
      log({ route: "register", status: 429 })
      return json({ error: "too many new installs from here, try again later" }, 429)
    }
    log({ route: "register", status: 200 })
    return json({ token: await newToken(deps.secret) })
  }

  const id = await tokenId(deps.secret, req.headers.get("x-install-token"))
  if (!id) {
    log({ route: "check", status: 401 })
    return json({ error: "install token missing or not valid" }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch (_) {
    return json({ error: "body must be JSON" }, 400)
  }
  const built = buildTask(body)
  if ("error" in built) {
    log({ route: "check", status: 400 })
    return json({ error: built.error }, 400)
  }

  if (!(await deps.rateHit("t:" + id, CHECKS_PER_HOUR))) {
    log({ route: "check", task: body.task, status: 429 })
    return json({ error: "hourly limit reached" }, 429)
  }

  try {
    const result = await deps.callModel(built.messages, built.schema, AbortSignal.timeout(MODEL_TIMEOUT_MS))
    log({ route: "check", task: body.task, status: 200 })
    return json({ result })
  } catch (err) {
    const timeout = (err as Error)?.name === "TimeoutError"
    // The error message can quote the request, so only its kind is logged
    log({ route: "check", task: body.task, status: timeout ? 504 : 502, error: (err as Error)?.name ?? "Error" })
    return json({ error: timeout ? "the model took too long" : "the model didn't answer" }, timeout ? 504 : 502)
  }
}
