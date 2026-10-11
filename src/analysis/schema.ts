// JSON schemas passed to Ollama as `format` so the model can only produce
// schema-valid JSON (structured outputs, Ollama ≥ 0.5), plus validators that
// never trust the model anyway.

import { GREEN_VERDICT, type Tone, type ToneAdvice, type ToneVerdict } from "./types"

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    tone:               { type: "string", enum: ["green", "yellow", "red"] },
    confidence:         { type: "number", minimum: 0, maximum: 1 },
    flagged_phrase:     { type: "string" },
    tone_tags_detected: { type: "boolean" },
  },
  required: ["tone", "confidence", "flagged_phrase", "tone_tags_detected"],
} as const

export const ADVICE_SCHEMA = {
  type: "object",
  properties: {
    label:       { type: "string" },
    explanation: { type: "string" },
    suggestion:  { type: "string" },
  },
  required: ["label", "explanation", "suggestion"],
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

  return { tone, confidence, flagged_phrase, tone_tags_detected: r.tone_tags_detected === true }
}

/** Safe advice for `message`; a "rewrite" identical to the message is no suggestion. */
export function validateAdvice(raw: unknown, message: string): ToneAdvice {
  const r = asRecord(raw) ?? {}
  let suggestion = str(r.suggestion, 400)
  if (suggestion === message.trim()) suggestion = ""
  return {
    label:       str(r.label, 60),
    explanation: str(r.explanation, 300),
    suggestion,
  }
}
