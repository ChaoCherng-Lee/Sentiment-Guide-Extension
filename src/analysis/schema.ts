// JSON schema for the tone result, passed to Ollama as `format` so the model
// can only produce schema-valid JSON (structured outputs, Ollama ≥ 0.5), plus
// a validator that never trusts the model anyway.

import { GREEN_RESULT, type Tone, type ToneResult } from "./types"

export const TONE_SCHEMA = {
  type: "object",
  properties: {
    tone:               { type: "string", enum: ["green", "yellow", "red"] },
    confidence:         { type: "number", minimum: 0, maximum: 1 },
    label:              { type: "string" },
    explanation:        { type: "string" },
    flagged_phrase:     { type: "string" },
    suggestion:         { type: "string" },
    tone_tags_detected: { type: "boolean" },
  },
  required: ["tone", "confidence", "label", "explanation", "flagged_phrase", "suggestion", "tone_tags_detected"],
} as const

const TONES: Tone[] = ["green", "yellow", "red"]

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim() : "").slice(0, max)

/**
 * Turn whatever the model returned into a safe ToneResult for `message`.
 * - Unknown tones fall back to green.
 * - flagged_phrase must be an exact (case-insensitive) substring of the
 *   message, otherwise it is dropped — the UI can't highlight a paraphrase.
 * - Green results carry no phrase or suggestion.
 */
export function validateToneResult(raw: unknown, message: string): ToneResult {
  if (!raw || typeof raw !== "object") return { ...GREEN_RESULT }
  const r = raw as Record<string, unknown>

  const tone = TONES.includes(r.tone as Tone) ? (r.tone as Tone) : "green"
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(1, r.confidence))
    : 1

  let flagged_phrase = str(r.flagged_phrase, 100)
  if (flagged_phrase && !message.toLowerCase().includes(flagged_phrase.toLowerCase())) flagged_phrase = ""

  let suggestion = str(r.suggestion, 400)
  // A "rewrite" identical to the message is no suggestion at all
  if (suggestion.trim() === message.trim()) suggestion = ""

  const result: ToneResult = {
    tone,
    confidence,
    label:              str(r.label, 60),
    explanation:        str(r.explanation, 300),
    flagged_phrase,
    suggestion,
    tone_tags_detected: r.tone_tags_detected === true,
  }
  if (tone === "green") {
    result.flagged_phrase = ""
    result.suggestion     = ""
  }
  return result
}
