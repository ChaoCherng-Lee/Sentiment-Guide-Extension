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
      /** The chat (hashed id) or "site:" + hostname, for what "It's fine" taught (Plan 9.4) */
      scope?: string
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
      /** The setup page's "try it" box: not counted in the week, never shared */
      trial?: boolean
    }
  /** Opt-in: how a received message probably reads. Low priority; never logged. */
  | { type: "READ_INCOMING"; text: string; key: string }
  | { type: "UPDATE_ACCEPTANCE"; eventId: string; accepted: boolean }
  /** "It's fine" on a flagged message, with the reason if one was picked. Kept on this computer. */
  | {
      type: "FINE_FEEDBACK"; eventId: string; tone: "yellow" | "red"; reason: FineReason | null
      /** The message, scrubbed in the page, and where it was written: kept on this computer to learn from (Plan 9.4) */
      snippet?: string; scope?: string
    }
  /** Link this browser to a parent with their 6-digit pairing code. */
  | { type: "PAIR"; code: string }
  /** Whether sharing with a parent is set up in this build, and paired. */
  | { type: "SHARING_STATUS" }
  /** Delete this child's shared data on the server and unlink from the parent. */
  | { type: "UNLINK_AND_DELETE" }
  /** Whether the AI is ready: the chosen backend's, or another one's (setup and Settings compare them). */
  | { type: "AI_STATUS"; backend?: BackendId }
  /** A supported site opened — load the model so the first check is fast. */
  | { type: "WARM_UP" }
  /** Open an extension page from a content script (they can't open tabs themselves). */
  | { type: "OPEN_PAGE"; page: "setup" | "settings" }

/**
 * Why a check produced no result. "cancelled" means a newer check replaced
 * it; "paused" means the extension is off or paused; "limit" means the
 * cloud check's hourly limit was reached; "language" means the message is
 * in a language the AI in use isn't tested on, so it wasn't checked.
 */
export type CheckFailure = "offline" | "no-model" | "timeout" | "limit" | "cancelled" | "paused" | "error" | "language"

export type ModelResponse<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: CheckFailure; /** With "language": ISO 639-1 code, or "unknown" */ language?: string }

export interface AIStatus {
  /** Where checks run */
  backend: BackendId
  /** ready = loaded; idle = installed but not in memory yet (first check is slow); see BackendState */
  state: BackendState
  model: string | null
  detail?: string
}

/**
 * What the badge should say when the AI can't check yet, or null when it can:
 * "offline" (can't be reached, or not possible here) or "no-model" (the
 * model needs installing or downloading). Both open the setup page.
 */
export function setupNeeded(state: BackendState): "offline" | "no-model" | null {
  switch (state) {
    case "ready":
    case "idle":        return null
    case "offline":
    case "unsupported": return "offline"
    default:            return "no-model"
  }
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
