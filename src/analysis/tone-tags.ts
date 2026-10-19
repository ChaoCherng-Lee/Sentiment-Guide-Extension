// Tone tags: short markers like /j or /srs that writers add to say how a
// message is meant. Detected in code rather than left to the model, so they
// are never missed.

export const TONE_TAGS: Record<string, string> = {
  j:    "joking",
  hj:   "half joking",
  lh:   "light-hearted",
  t:    "teasing",
  s:    "sarcastic",
  sarc: "sarcastic",
  hyp:  "exaggerating",
  nm:   "not mad",
  nbh:  "not about anyone here",
  pos:  "positive",
  gen:  "genuine",
  g:    "genuine",
  srs:  "serious",
  neg:  "negative",
}

/** Tags that say the words aren't meant literally. */
const NOT_LITERAL = new Set(["j", "hj", "lh", "t", "s", "sarc", "hyp", "nm", "nbh", "pos"])

// A tag is a slash and a known code, standing alone (start/space before, end/space/punctuation after)
const TAG_RE = new RegExp(`(?:^|\\s)/(${Object.keys(TONE_TAGS).join("|")})(?=$|[\\s.,!?)])`, "gi")

export interface FoundTag {
  tag: string       // as written, e.g. "/j"
  meaning: string
  notLiteral: boolean
}

/** Tone tags in the message, in order, one per distinct tag. */
export function findToneTags(text: string): FoundTag[] {
  const found: FoundTag[] = []
  for (const m of text.matchAll(TAG_RE)) {
    const code = m[1].toLowerCase()
    if (found.some(f => f.tag === "/" + code)) continue
    found.push({ tag: "/" + code, meaning: TONE_TAGS[code], notLiteral: NOT_LITERAL.has(code) })
  }
  return found
}
