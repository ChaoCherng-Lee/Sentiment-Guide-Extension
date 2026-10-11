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

export interface Responses {
  CHECK_TONE: ToneResult | null
  SAVE_CONTEXT: void
  UPDATE_ACCEPTANCE: void
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
