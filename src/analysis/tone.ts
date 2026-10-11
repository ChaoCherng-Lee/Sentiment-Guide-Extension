// Outgoing tone check, in two model calls: a fast verdict for every message,
// then advice (explanation + rewrite) only for flagged ones.

import { chatJSON } from "./ollama"
import { buildAdviceMessages, buildVerdictMessages } from "./prompts"
import { ADVICE_SCHEMA, VERDICT_SCHEMA, validateAdvice, validateVerdict } from "./schema"
import type { ChatContext, SuggestionStyle, ToneAdvice, ToneVerdict } from "./types"

export interface ModelCallOptions {
  model: string
  signal?: AbortSignal
  timeoutMs?: number
}

export async function judgeTone(text: string, context: ChatContext | null, opts: ModelCallOptions): Promise<ToneVerdict> {
  const raw = await chatJSON({ ...opts, messages: buildVerdictMessages(text, context), format: VERDICT_SCHEMA })
  return validateVerdict(raw, text)
}

export async function adviseTone(
  text: string,
  verdict: ToneVerdict,
  context: ChatContext | null,
  style: SuggestionStyle,
  opts: ModelCallOptions,
): Promise<ToneAdvice> {
  const raw = await chatJSON({ ...opts, messages: buildAdviceMessages(text, verdict, context, style), format: ADVICE_SCHEMA })
  return validateAdvice(raw, text)
}
