// GENERATED from src/analysis by scripts/sync-function.mjs — edit the original, then run npm run sync:function

// Emoji helpers for tone checks: counting user-perceived characters, finding
// the emoji in a message, and looking up how ambiguous ones are usually read.

import LEXICON from "./emoji-lexicon.json" with { type: "json" }

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu
const VARIATION = /\uFE0F/g
const ZWJ = "\u200D"

/** Which way an emoji usually pushes a message's tone. */
export type EmojiLean = "friendly" | "depends" | "negative"

interface LexiconEntry {
  lean: EmojiLean
  reading: string
}

export interface EmojiInfo extends LexiconEntry {
  emoji: string
}

const lexicon = LEXICON as Record<string, LexiconEntry>

/** Characters as a person counts them: "👍🏽" and "🤦‍♀️" are one each. */
export function graphemeLength(text: string): number {
  let n = 0
  for (const _ of segmenter.segment(text)) n++
  return n
}

/** Every emoji in the message, in order, duplicates included. */
export function findEmoji(text: string): string[] {
  const out: string[] = []
  for (const { segment } of segmenter.segment(text)) {
    if (PICTOGRAPHIC.test(segment)) out.push(segment)
  }
  return out
}

/** Lexicon key for an emoji: no skin tone or variation selector; ZWJ sequences fall back to their base. */
function lexiconKey(emoji: string): string | null {
  const plain = emoji.replace(SKIN_TONE, "").replace(VARIATION, "")
  if (plain in lexicon) return plain
  const base = plain.split(ZWJ)[0]
  return base in lexicon ? base : null
}

/** How an emoji is usually read, or null if it isn't one we have notes on. */
export function emojiReading(emoji: string): LexiconEntry | null {
  const key = lexiconKey(emoji)
  return key ? lexicon[key] : null
}

/** Lexicon entries for the emoji that appear in `text`, one per distinct emoji. */
export function emojiNotesFor(text: string): EmojiInfo[] {
  const seen = new Set<string>()
  const notes: EmojiInfo[] = []
  for (const emoji of findEmoji(text)) {
    const key = lexiconKey(emoji)
    if (!key || seen.has(key)) continue
    seen.add(key)
    notes.push({ emoji, ...lexicon[key] })
  }
  return notes
}

/** True if the text has something besides emoji and spaces. */
export function hasWords(text: string): boolean {
  for (const { segment } of segmenter.segment(text)) {
    if (!PICTOGRAPHIC.test(segment) && segment.trim()) return true
  }
  return false
}
