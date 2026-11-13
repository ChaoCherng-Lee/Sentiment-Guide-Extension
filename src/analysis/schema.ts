// JSON schemas passed to Ollama as `format` so the model can only produce
// schema-valid JSON (structured outputs, Ollama ≥ 0.5), plus validators that
// never trust the model anyway.

import { findEmoji, hasWords } from "./emoji"
import {
  type EmojiNote, FLAG_CATEGORIES, type FlagCategory, GREEN_VERDICT, type IncomingAnalysis, type IncomingReading, INCOMING_READINGS, type Tone, type ToneAdvice,
  type ToneEdit, type ToneVerdict,
} from "./types"

export const MAX_EDITS = 3
export const MAX_EMOJI_NOTES = 3

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    tone:               { type: "string", enum: ["green", "yellow", "red"] },
    confidence:         { type: "number", minimum: 0, maximum: 1 },
    flagged_phrase:     { type: "string" },
  },
  required: ["tone", "confidence", "flagged_phrase"],
} as const

export const ADVICE_SCHEMA = {
  type: "object",
  properties: {
    label:       { type: "string" },
    category:    { type: "string", enum: FLAG_CATEGORIES },
    explanation: { type: "string" },
    suggestion:  { type: "string" },
    edits: {
      type: "array",
      maxItems: MAX_EDITS,
      items: {
        type: "object",
        properties: {
          original:    { type: "string" },
          replacement: { type: "string" },
          reason:      { type: "string" },
        },
        required: ["original", "replacement", "reason"],
      },
    },
    emoji_notes: {
      type: "array",
      maxItems: MAX_EMOJI_NOTES,
      items: {
        type: "object",
        properties: {
          emoji:   { type: "string" },
          reading: { type: "string" },
        },
        required: ["emoji", "reading"],
      },
    },
  },
  required: ["label", "category", "explanation", "suggestion", "edits", "emoji_notes"],
} as const

export const INCOMING_SCHEMA = {
  type: "object",
  properties: {
    reading:     { type: "string", enum: INCOMING_READINGS },
    confidence:  { type: "number", minimum: 0, maximum: 1 },
    explanation: { type: "string" },
  },
  required: ["reading", "confidence", "explanation"],
} as const

const TONES: Tone[] = ["green", "yellow", "red"]

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim() : "").slice(0, max)

const asRecord = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === "object" ? raw as Record<string, unknown> : null

/**
 * Turn whatever the model returned into a safe verdict for `message`.
 * - Unknown tones fall back to green.
 * - flagged_phrase must be an exact (case-insensitive) substring of the
 *   message, otherwise it is dropped — the UI can't highlight a paraphrase.
 */
export function validateVerdict(raw: unknown, message: string): ToneVerdict {
  const r = asRecord(raw)
  if (!r) return { ...GREEN_VERDICT }

  const tone = TONES.includes(r.tone as Tone) ? (r.tone as Tone) : "green"
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(1, r.confidence))
    : 1

  let flagged_phrase = tone === "green" ? "" : str(r.flagged_phrase, 100)
  if (flagged_phrase && !message.toLowerCase().includes(flagged_phrase.toLowerCase())) flagged_phrase = ""

  return { tone, confidence, flagged_phrase }
}

/** Safe advice for `message`; a "rewrite" identical to the message is no suggestion. */
export function validateAdvice(raw: unknown, message: string): ToneAdvice {
  const r = asRecord(raw) ?? {}
  let suggestion = str(r.suggestion, 400)
  if (suggestion === message.trim()) suggestion = ""
  return {
    label:       str(r.label, 60),
    category:    FLAG_CATEGORIES.includes(r.category as FlagCategory) ? (r.category as FlagCategory) : "other",
    explanation: str(r.explanation, 300),
    suggestion,
    edits:       validateEdits(r.edits, message),
    emoji_notes: validateEmojiNotes(r.emoji_notes, message),
  }
}

/** Keep notes about emoji that are really in the message, one per emoji. */
export function validateEmojiNotes(raw: unknown, message: string): EmojiNote[] {
  if (!Array.isArray(raw)) return []
  const inMessage = new Set(findEmoji(message))
  const notes: EmojiNote[] = []
  for (const item of raw) {
    const r = asRecord(item)
    const emoji   = str(r?.emoji, 20)
    const reading = str(r?.reading, 100)
    if (!emoji || !reading || !inMessage.has(emoji) || notes.some(n => n.emoji === emoji)) continue
    notes.push({ emoji, reading })
    if (notes.length === MAX_EMOJI_NOTES) break
  }
  return notes
}

/**
 * Keep only edits that can be applied to `message`:
 * - `original` must appear in the message. Case is forgiven, but `original`
 *   is replaced with the message's own spelling so it can be found again.
 * - the replacement must actually change something
 * - no two edits may touch the same part of the message
 * At most MAX_EDITS are kept, in message order.
 */
export function validateEdits(raw: unknown, message: string): ToneEdit[] {
  if (!Array.isArray(raw)) return []
  const lower = message.toLowerCase()
  const kept: (ToneEdit & { at: number })[] = []

  for (const item of raw) {
    const r = asRecord(item)
    if (!r) continue
    const wanted      = str(r.original, 100)
    const replacement = str(r.replacement, 200)
    if (!wanted) continue
    // An empty replacement deletes — fine for an emoji, never for words
    if (!replacement && (hasWords(wanted) || !findEmoji(wanted).length)) continue
    if (replacement.toLowerCase() === wanted.toLowerCase()) continue

    const at = lower.indexOf(wanted.toLowerCase())
    if (at === -1) continue
    const end = at + wanted.length
    if (kept.some(k => at < k.at + k.original.length && k.at < end)) continue

    kept.push({ original: message.slice(at, end), replacement, reason: str(r.reason, 120), at })
    if (kept.length === MAX_EDITS) break
  }

  return kept.sort((a, b) => a.at - b.at).map(({ at: _, ...edit }) => edit)
}

// Words that make a reading a guess rather than a statement about the sender
const HEDGE = /\b(probably|might|may|maybe|could|perhaps|likely|seems?|sounds?|possibly)\b/i

/**
 * Safe reading of a received message. Unknown readings become "unclear",
 * and an explanation that states the sender's feelings as fact is hedged.
 */
export function validateIncoming(raw: unknown): IncomingAnalysis {
  const r = asRecord(raw) ?? {}
  const reading = INCOMING_READINGS.includes(r.reading as IncomingReading) ? (r.reading as IncomingReading) : "unclear"
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(1, r.confidence))
    : 0.5
  let explanation = str(r.explanation, 240)
  if (explanation && !HEDGE.test(explanation)) {
    explanation = "Hard to say for sure, but " + explanation[0].toLowerCase() + explanation.slice(1)
  }
  return { reading, confidence, explanation }
}
