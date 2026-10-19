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
  return applyBanterRule(validateVerdict(raw, text), text, context)
}

// lol, lmao, lmfao, haha(ha), hehe, rofl, plus laughing emoji
const LAUGHTER = /\b(lo+l|lmf?a+o+|(?:ha){2,}h?|(?:he){2,}|rofl)\b|💀|☠|😂|🤣|😭/i

/**
 * In a chat the user says is "very casual — we joke and tease", a tease that
 * comes with laughter is banter: the model tends to rate it yellow anyway, so
 * it is let through. Red is never softened.
 */
export function applyBanterRule(verdict: ToneVerdict, text: string, context: ChatContext | null): ToneVerdict {
  if (verdict.tone !== "yellow" || context?.q2 !== "very_casual" || !LAUGHTER.test(text)) return verdict
  return { ...verdict, tone: "green", flagged_phrase: "" }
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
