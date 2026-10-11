// Typed messages between content scripts / pages and the background worker.
import { browser } from "#imports"
import type { ChatContext, ToneResult } from "./analysis/types"

export type Message =
  | {
      type: "CHECK_TONE"
      text: string
      context: ChatContext | null
      eventId: string
      contactHash: string | null
      /** Compose box that asked — a newer request from it supersedes older ones. */
      sessionId: string
    }
  | { type: "SAVE_CONTEXT"; context: ChatContext; contactHash: string }
  | { type: "UPDATE_ACCEPTANCE"; eventId: string; accepted: boolean }
  /** Ask whether the local model is reachable and loaded. */
  | { type: "AI_STATUS" }
  /** A supported site opened — load the model so the first check is fast. */
  | { type: "WARM_UP" }

/** Why a check produced no result. "cancelled" means a newer check replaced it. */
export type CheckFailure = "offline" | "no-model" | "timeout" | "cancelled" | "error"

export type CheckToneResponse =
  | { ok: true; result: ToneResult }
  | { ok: false; reason: CheckFailure }

export interface AIStatus {
  /** ready = loaded; idle = installed but not in memory yet (first check is slow) */
  state: "ready" | "idle" | "offline" | "no-model"
  model: string | null
}

export interface Responses {
  CHECK_TONE: CheckToneResponse
  SAVE_CONTEXT: void
  UPDATE_ACCEPTANCE: void
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
