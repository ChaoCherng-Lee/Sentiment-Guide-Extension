// Learns from "It's fine" (Plan 9.4, Spec FR-3.3). When the user says a
// flagged message was fine, a short scrubbed snippet of it is kept on this
// computer, per chat (or per site where there are no chats). Later checks in
// that chat pass the 3 most similar as "this user considers these fine", and
// a yellow the model isn't sure about is let through when one is close.
//
// At most 50 snippets per chat or site, 120 characters each, emails, phone
// numbers and the contact's name taken out in the page before they get here.
// Never uploaded; never sent to the cloud check (only to an AI on this
// computer); removed by "delete everything" (Plan 11.3).

import { browser } from "#imports"

export const FINE_EXAMPLES_PER_SCOPE = 50
export const FINE_EXAMPLE_MAX_CHARS  = 120
/** Similar examples passed to the model */
export const SIMILAR_EXAMPLES = 3
/** Trigram similarity (0–1) for an example to count as "like this one" */
export const MIN_SIMILARITY = 0.25

export interface FineExample {
  text: string
  /** ms since epoch */
  at: number
}

/** Snippets by scope: a hashed chat id, or "site:" + hostname */
export type FineExamples = Record<string, FineExample[]>

const KEY = "fineExamples"

/** Add a snippet to its scope: newest first, no repeats, capped. */
export function addExample(all: FineExamples, scope: string, text: string, at = Date.now()): FineExamples {
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, FINE_EXAMPLE_MAX_CHARS)
  if (!snippet) return all
  const kept = (all[scope] ?? []).filter(e => e.text.toLowerCase() !== snippet.toLowerCase())
  return { ...all, [scope]: [{ text: snippet, at }, ...kept].slice(0, FINE_EXAMPLES_PER_SCOPE) }
}

function trigrams(text: string): Set<string> {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `
  const out = new Set<string>()
  const chars = [...t]
  for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""))
  return out
}

/** Jaccard similarity of character trigrams, 0–1. Works for any language and for emoji. */
export function similarity(a: string, b: string): number {
  const x = trigrams(a), y = trigrams(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const g of x) if (y.has(g)) both++
  return both / (x.size + y.size - both)
}

/** The examples most like `text`, most similar first, at least MIN_SIMILARITY. */
export function similarExamples(examples: FineExample[], text: string, n = SIMILAR_EXAMPLES): { text: string; score: number }[] {
  return examples
    .map(e => ({ text: e.text, score: similarity(e.text, text) }))
    .filter(e => e.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}

let writing: Promise<unknown> = Promise.resolve()

/** Keep a snippet. Called by the background worker only, one write at a time. */
export function rememberFine(scope: string, text: string): Promise<void> {
  const next = writing.then(async () => {
    const all = ((await browser.storage.local.get(KEY))[KEY] ?? {}) as FineExamples
    await browser.storage.local.set({ [KEY]: addExample(all, scope, text) })
  })
  writing = next.catch(() => {})
  return next
}

export async function examplesFor(scope: string): Promise<FineExample[]> {
  const all = ((await browser.storage.local.get(KEY))[KEY] ?? {}) as FineExamples
  return all[scope] ?? []
}

export async function forgetAllFine(): Promise<void> {
  await browser.storage.local.remove(KEY)
}
