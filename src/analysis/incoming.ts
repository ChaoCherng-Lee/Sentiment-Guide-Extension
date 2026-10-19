// Incoming analysis (opt-in): explain how a received message probably reads.
// One model call; the result is never stored or logged.

import { chatJSON } from "./ollama"
import { buildIncomingMessages } from "./prompts"
import { INCOMING_SCHEMA, validateIncoming } from "./schema"
import type { ModelCallOptions } from "./tone"
import type { IncomingAnalysis, IncomingReading } from "./types"

export async function readIncoming(text: string, opts: ModelCallOptions): Promise<IncomingAnalysis> {
  const raw = await chatJSON({ ...opts, messages: buildIncomingMessages(text), format: INCOMING_SCHEMA })
  return validateIncoming(raw)
}

/** Friendly and neutral readings get no badge — only ones worth a second look do. */
export function worthABadge(reading: IncomingReading): boolean {
  return reading !== "friendly" && reading !== "neutral"
}
