// Recent messages from the open chat, as context for a tone check (opt-in).
// Scrubbed here, in the page, before they go anywhere: at most 6 messages,
// each cut to 200 characters, with the contact's name, emails and phone
// numbers taken out. They are only ever sent to the local model, and never
// stored or logged.

import type { ChatMessage } from "./types"

export const RECENT_LIMIT     = 6
export const RECENT_MAX_CHARS = 200

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
// A run of digits with the usual separators; only counts as a phone number with 7+ digits
const PHONE = /[+(]?\d[\d\s().-]{5,}\d/g
const MIN_PHONE_DIGITS = 7

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The full name and each word of it (3+ letters), longest first. */
function nameParts(names: string[]): string[] {
  const parts = new Set<string>()
  for (const name of names) {
    const full = name.trim()
    if (!full) continue
    parts.add(full)
    for (const word of full.split(/\s+/)) if ([...word].length >= 3) parts.add(word)
  }
  return [...parts].sort((a, b) => b.length - a.length)
}

/** Remove emails, phone numbers and the given names from one message. */
export function scrub(text: string, names: string[] = []): string {
  let out = text
    .replace(EMAIL, "[email]")
    .replace(PHONE, m => (m.replace(/\D/g, "").length >= MIN_PHONE_DIGITS ? "[phone]" : m))
  for (const part of nameParts(names)) {
    // Whole words only, so "Al" in a name never turns "also" into "Themso"
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, "giu"), "Them")
  }
  return out
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Cut to `max` characters as a person counts them, so an emoji is never split. */
export function truncate(text: string, max = RECENT_MAX_CHARS): string {
  const chars = [...segmenter.segment(text)].map(s => s.segment)
  return chars.length <= max ? text : chars.slice(0, max - 1).join("").trimEnd() + "…"
}

/**
 * Make raw chat messages safe to use as context: the last RECENT_LIMIT
 * non-empty ones, on one line each, scrubbed and cut to length.
 * `names` are the contact's names (e.g. the chat title).
 */
export function prepareRecent(messages: ChatMessage[], names: (string | null)[] = []): ChatMessage[] {
  const hide = names.filter((n): n is string => !!n)
  return messages
    .map(m => ({ from: m.from, text: m.text.replace(/\s+/g, " ").trim() }))
    .filter(m => m.text)
    .slice(-RECENT_LIMIT)
    .map(m => ({ from: m.from, text: truncate(scrub(m.text, hide)) }))
}
