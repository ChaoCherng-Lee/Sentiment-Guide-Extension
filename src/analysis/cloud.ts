// =============================================================================
// The "cloud" backend: the private cloud check (Plan 8.3, Spec FR-4.3), a
// Supabase Edge Function (supabase/functions/tone-check) that asks a hosted
// model the extension's own questions and forgets the message.
//
// What it gets: the message, and the chat's context answers (relationship,
// mood…) when there are any. Never the chat itself: `local` is false, so the
// background worker sends no recent messages, and the function refuses them
// anyway. Each install has an anonymous token, created on first use, so the
// function can cap checks per hour without knowing who anyone is.
// =============================================================================

import { BackendError, type BackendStatus, type CallOptions, callSignal, type ToneBackend } from "./backend"
import { validateAdvice, validateIncoming } from "./schema"
import { verdictFromRaw } from "./tone"
import type { ChatContext } from "./types"

export interface TokenStore {
  get(): Promise<string | null>
  set(token: string | null): Promise<void>
}

export interface CloudConfig {
  /** …/functions/v1/tone-check */
  url: string
  /** The project's public (anon) key: Supabase's gateway asks for one */
  anonKey: string
  tokens: TokenStore
  fetchImpl?: typeof fetch
}

const CHECK_TIMEOUT_MS = 15_000

/** Only the answers the prompt uses: no names, no chat. */
function contextAnswers(context: ChatContext | null) {
  if (!context) return null
  const { q1, q2, q3, q4, q5 } = context
  return { q1, q2, q3, q4, q5 }
}

export function cloudBackend(cfg: CloudConfig | null): ToneBackend {
  const doFetch = (input: string, init: RequestInit) => (cfg?.fetchImpl ?? fetch)(input, init)
  const headers = (extra: Record<string, string> = {}) => ({
    "Content-Type": "application/json",
    apikey: cfg!.anonKey,
    Authorization: `Bearer ${cfg!.anonKey}`,
    ...extra,
  })

  async function register(signal: AbortSignal): Promise<string> {
    const res = await doFetch(`${cfg!.url}/register`, { method: "POST", headers: headers(), body: "{}", signal })
    if (res.status === 429) throw new BackendError("rate-limited", "too many new installs from this network")
    if (!res.ok) throw new BackendError("bad-response", `cloud check HTTP ${res.status}`)
    const { token } = await res.json() as { token?: string }
    if (!token) throw new BackendError("bad-response", "no install token")
    await cfg!.tokens.set(token)
    return token
  }

  async function call(task: string, body: Record<string, unknown>, opts: CallOptions = {}): Promise<unknown> {
    if (!cfg) throw new BackendError("unsupported", "the cloud check isn't set up in this build")
    const signal = callSignal(opts, CHECK_TIMEOUT_MS)
    try {
      for (let attempt = 0; ; attempt++) {
        const token = (await cfg.tokens.get()) ?? await register(signal)
        const res = await doFetch(cfg.url, {
          method: "POST",
          headers: headers({ "x-install-token": token }),
          body: JSON.stringify({ task, ...body }),
          signal,
        })
        // A token the server no longer accepts (its secret changed): get a new one, once
        if (res.status === 401 && attempt === 0) { await cfg.tokens.set(null); continue }
        if (res.status === 429) throw new BackendError("rate-limited", "hourly limit reached")
        if (res.status === 504) throw new BackendError("timeout", "the cloud model took too long")
        if (!res.ok) throw new BackendError("bad-response", `cloud check HTTP ${res.status}`)
        return ((await res.json()) as { result?: unknown }).result
      }
    } catch (err) {
      if (err instanceof BackendError) throw err
      if (signal.aborted && signal.reason instanceof BackendError) throw signal.reason
      throw new BackendError("offline", (err as Error).message)
    }
  }

  return {
    id:    "cloud",
    local: false,
    async status(): Promise<BackendStatus> {
      if (!cfg) return { state: "unsupported", model: null, detail: "The cloud check isn't set up in this build" }
      try {
        const res = await doFetch(cfg.url, { method: "GET", headers: headers(), signal: AbortSignal.timeout(4000) })
        return res.ok ? { state: "ready", model: null } : { state: "offline", model: null, detail: `HTTP ${res.status}` }
      } catch (_) {
        return { state: "offline", model: null, detail: "Can't reach the cloud check — are you online?" }
      }
    },
    isCold: async () => false,
    warm:   async () => {},
    async judge(text, context, _recent, opts) {
      const raw = await call("verdict", { text, context: contextAnswers(context) }, opts)
      return verdictFromRaw(raw, text, context)
    },
    async advise(text, verdict, context, style, _recent, opts) {
      const raw = await call("advice", { text, verdict, style, context: contextAnswers(context) }, opts)
      return validateAdvice(raw, text)
    },
    async readIncoming(text, opts) {
      return validateIncoming(await call("incoming", { text }, opts))
    },
  }
}
