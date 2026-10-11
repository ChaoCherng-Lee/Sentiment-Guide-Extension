// Shared types for tone analysis — used by the background worker and the
// content scripts.

export type Tone = "green" | "yellow" | "red"

export interface ToneResult {
  tone: Tone
  confidence: number
  label: string
  explanation: string
  flagged_phrase: string
  suggestion: string
  tone_tags_detected: boolean
}

export const GREEN_RESULT: ToneResult = {
  tone: "green",
  confidence: 1,
  label: "",
  explanation: "",
  flagged_phrase: "",
  suggestion: "",
  tone_tags_detected: false,
}

export type Platform = "whatsapp" | "instagram" | "gmail" | "outlook"

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
