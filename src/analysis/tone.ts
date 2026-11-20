// Outgoing tone check, in two model calls: a fast verdict for every message,
// then advice (explanation + rewrite) only for flagged ones. Works with any
// backend that can answer a chat with JSON (backend.ts).

import type { CallOptions, ChatJSON } from "./backend"
import { buildAdviceMessages, buildVerdictMessages } from "./prompts"
import { ADVICE_SCHEMA, VERDICT_SCHEMA, validateAdvice, validateVerdict } from "./schema"
import type { ChatContext, ChatMessage, SuggestionStyle, ToneAdvice, ToneVerdict } from "./types"

/** `recent`: the last few messages in the chat, already scrubbed (chat-context.ts). */
export async function judgeTone(
  chat: ChatJSON,
  text: string,
  context: ChatContext | null,
  opts: CallOptions = {},
  recent: ChatMessage[] = [],
): Promise<ToneVerdict> {
  const raw = await chat({ ...opts, messages: buildVerdictMessages(text, context, recent), format: VERDICT_SCHEMA })
  return verdictFromRaw(raw, text, context)
}

/** Check the model's verdict and apply the rules on top of it. */
export function verdictFromRaw(raw: unknown, text: string, context: ChatContext | null): ToneVerdict {
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
  chat: ChatJSON,
  text: string,
  verdict: ToneVerdict,
  context: ChatContext | null,
  style: SuggestionStyle,
  opts: CallOptions = {},
  recent: ChatMessage[] = [],
): Promise<ToneAdvice> {
  const raw = await chat({ ...opts, messages: buildAdviceMessages(text, verdict, context, style, recent), format: ADVICE_SCHEMA })
  return validateAdvice(raw, text)
}
