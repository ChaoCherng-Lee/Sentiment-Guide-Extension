// JSON schemas passed to Ollama as `format` so the model can only produce
// schema-valid JSON (structured outputs, Ollama ≥ 0.5), plus validators that
// never trust the model anyway.

import { GREEN_VERDICT, type Tone, type ToneAdvice, type ToneEdit, type ToneVerdict } from "./types"

export const MAX_EDITS = 3

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
  },
  required: ["label", "explanation", "suggestion", "edits"],
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
    edits:       validateEdits(r.edits, message),
  }
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
    if (!wanted || !replacement) continue
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
