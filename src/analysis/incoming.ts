// Incoming analysis (opt-in): explain how a received message probably reads.
// One model call; the result is never stored or logged.

import type { CallOptions, ChatJSON } from "./backend"
import { buildIncomingMessages } from "./prompts"
import { INCOMING_SCHEMA, validateIncoming } from "./schema"
import type { IncomingAnalysis, IncomingReading } from "./types"

export async function readIncoming(chat: ChatJSON, text: string, opts: CallOptions = {}): Promise<IncomingAnalysis> {
  const raw = await chat({ ...opts, messages: buildIncomingMessages(text), format: INCOMING_SCHEMA })
  return validateIncoming(raw)
}

/** Friendly and neutral readings get no badge — only ones worth a second look do. */
export function worthABadge(reading: IncomingReading): boolean {
  return reading !== "friendly" && reading !== "neutral"
}
