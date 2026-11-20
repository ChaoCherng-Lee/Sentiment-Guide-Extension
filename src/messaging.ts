// Typed messages between content scripts / pages and the background worker.
import { browser } from "#imports"
import type { BackendId, BackendState } from "./analysis/backend"
import type {
  ChatContext, ChatMessage, IncomingAnalysis, SuggestionStyle, ToneAdvice, ToneVerdict,
} from "./analysis/types"
import type { FineReason } from "./settings/feedback"

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
      /** Site the message was written on — the only thing about it a parent may see */
      platform: "whatsapp" | "instagram" | "gmail" | "web"
      sessionId: string
    }
  /** Opt-in: how a received message probably reads. Low priority; never logged. */
  | { type: "READ_INCOMING"; text: string; key: string }
  | { type: "UPDATE_ACCEPTANCE"; eventId: string; accepted: boolean }
  /** "It's fine" on a flagged message, with the reason if one was picked. Kept on this computer. */
  | { type: "FINE_FEEDBACK"; eventId: string; tone: "yellow" | "red"; reason: FineReason | null }
  /** Link this browser to a parent with their 6-digit pairing code. */
  | { type: "PAIR"; code: string }
  /** Whether sharing with a parent is set up in this build, and paired. */
  | { type: "SHARING_STATUS" }
  /** Delete this child's shared data on the server and unlink from the parent. */
  | { type: "UNLINK_AND_DELETE" }
  /** Ask whether the local model is reachable and loaded. */
  | { type: "AI_STATUS" }
  /** A supported site opened — load the model so the first check is fast. */
  | { type: "WARM_UP" }
  /** Open an extension page from a content script (they can't open tabs themselves). */
  | { type: "OPEN_PAGE"; page: "setup" | "settings" }

/**
 * Why a check produced no result. "cancelled" means a newer check replaced
 * it; "paused" means the extension is off or paused.
 */
export type CheckFailure = "offline" | "no-model" | "timeout" | "cancelled" | "paused" | "error"

export type ModelResponse<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: CheckFailure }

export interface AIStatus {
  /** Where checks run */
  backend: BackendId
  /** ready = loaded; idle = installed but not in memory yet (first check is slow); see BackendState */
  state: BackendState
  model: string | null
  detail?: string
}

export interface Responses {
  CHECK_TONE: ModelResponse<{ verdict: ToneVerdict }>
  GET_ADVICE: ModelResponse<{ advice: ToneAdvice }>
  READ_INCOMING: ModelResponse<{ analysis: IncomingAnalysis }>
  UPDATE_ACCEPTANCE: void
  FINE_FEEDBACK: void
  PAIR: PairResult
  SHARING_STATUS: { configured: boolean; paired: boolean }
  UNLINK_AND_DELETE: boolean
  AI_STATUS: AIStatus
  WARM_UP: void
  OPEN_PAGE: void
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
