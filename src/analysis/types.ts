// Shared types for tone analysis — used by the background worker and the
// content scripts.

export type Tone = "green" | "yellow" | "red"

/**
 * Step 1 of a check: is the message OK? Short, so the model answers in ~2 s.
 * Every message gets one.
 */
export interface ToneVerdict {
  tone: Tone
  confidence: number
  /** Exact substring of the message that caused concern; "" if green */
  flagged_phrase: string
  tone_tags_detected: boolean
}

/**
 * Step 2, only for yellow/red: why, and a kinder way to say it. Writing this
 * is what takes most of the model's time.
 */
export interface ToneAdvice {
  label: string
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

export const GREEN_VERDICT: ToneVerdict = {
  tone: "green",
  confidence: 1,
  flagged_phrase: "",
  tone_tags_detected: false,
}

/** What the rewrites should sound like. Affects advice only, never the verdict. */
export type SuggestionStyle = "casual" | "formal" | "direct"

export const SUGGESTION_STYLES: SuggestionStyle[] = ["casual", "formal", "direct"]

export type Platform = "whatsapp" | "instagram" | "gmail" | "outlook"

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
