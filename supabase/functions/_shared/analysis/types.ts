// GENERATED from src/analysis by scripts/sync-function.mjs — edit the original, then run npm run sync:function

// Shared types for tone analysis — used by the background worker and the
// content scripts.

export type Tone = "green" | "yellow" | "red"

/**
 * Step 1 of a check: is the message OK? Kept short — every field the model
 * writes adds time — so the model answers in ~2-3 s.
 * Every message gets one.
 */
export interface ToneVerdict {
  tone: Tone
  confidence: number
  /** Exact substring of the message that caused concern; "" if green */
  flagged_phrase: string
}

/**
 * Step 2, only for yellow/red: why, and a kinder way to say it. Writing this
 * is what takes most of the model's time.
 */
export interface ToneAdvice {
  label: string
  /** What kind of problem, from a fixed list — the only description a parent's dashboard ever gets */
  category: FlagCategory
  explanation: string
  /** Kinder rewrite of the whole message; "" if none */
  suggestion: string
  /** Phrase-level fixes the user can apply one at a time (at most 3) */
  edits: ToneEdit[]
  /** How emoji in the message may come across (at most 3) */
  emoji_notes: EmojiNote[]
}

export interface EmojiNote {
  emoji: string
  reading: string
}

/** Swap one phrase for a kinder one; `original` is verbatim from the message. */
export interface ToneEdit {
  original: string
  /** "" removes `original` — only allowed for emoji */
  replacement: string
  reason: string
}

export const FLAG_CATEGORIES = [
  "insult", "mean_joke", "sarcasm", "dismissive", "harsh_tone", "threat", "exclusion", "other",
] as const
export type FlagCategory = (typeof FLAG_CATEGORIES)[number]

/** How a received message probably reads (incoming analysis, opt-in). */
export type IncomingReading = "friendly" | "teasing" | "neutral" | "sarcastic" | "upset" | "angry" | "unclear"

export const INCOMING_READINGS: IncomingReading[] = ["friendly", "teasing", "neutral", "sarcastic", "upset", "angry", "unclear"]

/** Explains a received message — never judges it. Never stored or logged. */
export interface IncomingAnalysis {
  reading: IncomingReading
  confidence: number
  /** 1–2 hedged sentences ("probably", "might") */
  explanation: string
}

export const GREEN_VERDICT: ToneVerdict = {
  tone: "green",
  confidence: 1,
  flagged_phrase: "",
}

/** What the rewrites should sound like. Affects advice only, never the verdict. */
export type SuggestionStyle = "casual" | "formal" | "direct"

export const SUGGESTION_STYLES: SuggestionStyle[] = ["casual", "formal", "direct"]

/**
 * How readily messages are flagged (Spec FR-3.1). Gentle: only what would
 * clearly hurt. Balanced (default). Strict: also cold or curt messages.
 */
export type Sensitivity = "gentle" | "balanced" | "strict"
export const SENSITIVITIES: Sensitivity[] = ["gentle", "balanced", "strict"]

/** Where a message was written. "web" is any other website (a plain text box). */
export type Platform = "whatsapp" | "instagram" | "gmail" | "outlook" | "web"

/** One message from the open chat, for context. Never stored or logged. */
export interface ChatMessage {
  from: "me" | "them"
  text: string
}

/** Answers from the per-chat context form. */
export interface ChatContext {
  platform: Platform
  q1: string   // relationship
  q2: string   // communication style
  q3: string   // child uses tone tags
  q4: string   // recipient uses tone tags
  q5: string   // conversation mood
  savedAt: number
}
