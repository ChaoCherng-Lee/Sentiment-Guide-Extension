// Typed messages between content scripts / pages and the background worker.
import { browser } from "#imports"
import type {
  ChatContext, ChatMessage, IncomingAnalysis, SuggestionStyle, ToneAdvice, ToneVerdict,
} from "./analysis/types"

export type PairResult = "ok" | "invalid" | "too_many" | "not_configured" | "error"

export type Message =
  /** Step 1: fast verdict for every message. */
  | {
      type: "CHECK_TONE"
      text: string
      context: ChatContext | null
      /** Last few chat messages, scrubbed; [] unless chat context is on. Never logged. */
      recent: ChatMessage[]
      /** Compose box that asked — a newer request from it supersedes older ones. */
      sessionId: string
    }
  /** Step 2, for yellow/red verdicts: explanation and kinder rewrite. */
  | {
      type: "GET_ADVICE"
      text: string
      verdict: ToneVerdict
      context: ChatContext | null
      recent: ChatMessage[]
      style: SuggestionStyle
      eventId: string
      contactHash: string | null
      sessionId: string
    }
  /** Opt-in: how a received message probably reads. Low priority; never logged. */
  | { type: "READ_INCOMING"; text: string; key: string }
  | { type: "SAVE_CONTEXT"; context: ChatContext; contactHash: string }
  | { type: "UPDATE_ACCEPTANCE"; eventId: string; accepted: boolean }
  /** Link this browser to a parent with their 6-digit pairing code. */
  | { type: "PAIR"; code: string }
  /** Whether sharing with a parent is set up in this build, and paired. */
  | { type: "SHARING_STATUS" }
  /** Ask whether the local model is reachable and loaded. */
  | { type: "AI_STATUS" }
  /** A supported site opened — load the model so the first check is fast. */
  | { type: "WARM_UP" }

/**
 * Why a check produced no result. "cancelled" means a newer check replaced
 * it; "paused" means the extension is off or paused.
 */
export type CheckFailure = "offline" | "no-model" | "timeout" | "cancelled" | "paused" | "error"

export type ModelResponse<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: CheckFailure }

export interface AIStatus {
  /** ready = loaded; idle = installed but not in memory yet (first check is slow) */
  state: "ready" | "idle" | "offline" | "no-model"
  model: string | null
}

export interface Responses {
  CHECK_TONE: ModelResponse<{ verdict: ToneVerdict }>
  GET_ADVICE: ModelResponse<{ advice: ToneAdvice }>
  READ_INCOMING: ModelResponse<{ analysis: IncomingAnalysis }>
  SAVE_CONTEXT: void
  UPDATE_ACCEPTANCE: void
  PAIR: PairResult
  SHARING_STATUS: { configured: boolean; paired: boolean }
  AI_STATUS: AIStatus
  WARM_UP: void
}

export type MessageOf<T extends Message["type"]> = Extract<Message, { type: T }>

/**
 * Send a message to the background worker. Resolves undefined instead of
 * throwing when the extension context is gone (e.g. after an update).
 */
export async function sendMessage<M extends Message>(msg: M): Promise<Responses[M["type"]] | undefined> {
  try {
    if (!browser?.runtime?.id) return undefined
    return await browser.runtime.sendMessage(msg)
  } catch (err) {
    console.log("Sentiment Guide: sendMessage failed —", (err as Error).message)
    return undefined
  }
}
