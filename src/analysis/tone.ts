// Outgoing tone check: prompt → model → validated result.

import { chatJSON } from "./ollama"
import { buildToneMessages } from "./prompts"
import { TONE_SCHEMA, validateToneResult } from "./schema"
import type { ChatContext, ToneResult } from "./types"

export interface CheckToneOptions {
  model: string
  signal?: AbortSignal
  timeoutMs?: number
}

export async function analyseTone(text: string, context: ChatContext | null, opts: CheckToneOptions): Promise<ToneResult> {
  const raw = await chatJSON({
    model:     opts.model,
    messages:  buildToneMessages(text, context),
    format:    TONE_SCHEMA,
    signal:    opts.signal,
    timeoutMs: opts.timeoutMs,
  })
  return validateToneResult(raw, text)
}
