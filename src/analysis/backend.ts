// =============================================================================
// Where the tone checks run (Plan 8.1, Spec FR-4).
//
// One interface, several backends:
//   - "ollama"  : Ollama on this computer (advanced, fully private)
//   - "builtin" : Chrome's built-in AI, Gemini Nano (on this computer)
//   - "cloud"   : our private cloud check (text checked and forgotten)
//
// The queue, the engine and the eval only see `ToneBackend`; each backend
// file knows how to reach its model. Prompts and answer checks are shared
// (prompts.ts, schema.ts), so every backend asks the same questions.
// =============================================================================

import type { ChatTurn } from "./prompts"
import type { ChatContext, ChatMessage, IncomingAnalysis, SuggestionStyle, ToneAdvice, ToneVerdict } from "./types"

export const BACKEND_IDS = ["ollama", "builtin", "cloud"] as const
export type BackendId = (typeof BACKEND_IDS)[number]

export type BackendErrorKind =
  | "offline"       // can't reach it (Ollama not running, no network)
  | "no-model"      // reachable, but the model isn't there (yet)
  | "timeout"
  | "aborted"       // a newer check replaced this one
  | "bad-response"  // answered, but not with what we asked for
  | "unsupported"   // this computer or browser can't run it
  | "rate-limited"  // the cloud check's hourly limit for this install

export class BackendError extends Error {
  constructor(readonly kind: BackendErrorKind, message: string) {
    super(message)
  }
}

/**
 * ready       : will answer quickly
 * idle        : will answer, but the first check loads the model (slow)
 * offline     : can't be reached
 * no-model    : reachable, model not installed (Ollama)
 * downloadable: the model can be downloaded (built-in AI)
 * downloading : the model is downloading
 * unsupported : not possible on this computer
 */
export type BackendState = "ready" | "idle" | "offline" | "no-model" | "downloadable" | "downloading" | "unsupported"

export interface BackendStatus {
  state: BackendState
  /** Model name where it means something to the user (Ollama) */
  model: string | null
  /** Why it's unsupported, or download progress, in a few words */
  detail?: string
}

export interface CallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ToneBackend {
  readonly id: BackendId
  /**
   * Runs on this computer. Chat context (the other person's messages) is
   * only ever sent to a local backend.
   */
  readonly local: boolean
  status(): Promise<BackendStatus>
  /** The next call has to load the model first, so it gets a longer timeout. */
  isCold(): Promise<boolean>
  /** Load the model ahead of the first check. */
  warm(): Promise<void>
  /** Step 1: fast verdict. `recent`: the last few chat messages, already scrubbed. */
  judge(text: string, context: ChatContext | null, recent: ChatMessage[], opts?: CallOptions): Promise<ToneVerdict>
  /** Step 2, for flagged messages: explanation, rewrite and phrase edits. */
  advise(text: string, verdict: ToneVerdict, context: ChatContext | null, style: SuggestionStyle, recent: ChatMessage[], opts?: CallOptions): Promise<ToneAdvice>
  /** Opt-in: how a received message probably reads. */
  readIncoming(text: string, opts?: CallOptions): Promise<IncomingAnalysis>
}

/** One chat call that must answer with JSON matching `format`. */
export type ChatJSON = (req: { messages: ChatTurn[]; format: object } & CallOptions) => Promise<unknown>

/**
 * An AbortSignal for one call that fires on the caller's signal (a newer
 * check) or after `timeoutMs`, whichever comes first, with a BackendError
 * saying which.
 */
export function callSignal(opts: CallOptions, defaultTimeoutMs = 60_000): AbortSignal {
  const ms   = opts.timeoutMs ?? defaultTimeoutMs
  const ctrl = new AbortController()
  const abort = (reason: unknown) => { if (!ctrl.signal.aborted) ctrl.abort(reason) }
  const timer = setTimeout(() => abort(new BackendError("timeout", `no reply after ${ms} ms`)), ms)
  ctrl.signal.addEventListener("abort", () => clearTimeout(timer))
  opts.signal?.addEventListener("abort", () => abort(new BackendError("aborted", "request cancelled")))
  if (opts.signal?.aborted) abort(new BackendError("aborted", "request cancelled"))
  return ctrl.signal
}
