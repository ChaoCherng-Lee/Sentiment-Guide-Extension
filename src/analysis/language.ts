// =============================================================================
// Language check (Plan 9.2, Spec FR-3.4): a message in a language the AI in
// use hasn't been tested on gets "Not checked: language" instead of a guess.
//
// The costly mistake is calling an English message foreign, because then a
// hurtful message goes unchecked. So a message is only skipped on a strong
// signal:
//   - mostly written in a non-Latin script (Chinese, Korean, Arabic…), or
//   - three or more words, fewer than a third of them common English or chat
//     words, and the detector (tinyld, 68 KB, works offline) names another
//     language without English coming a close second.
// Short Latin-script messages ("ok boomer", "vai se foder") are always
// checked: no detector can tell them apart reliably.
// =============================================================================

import { detect, detectAll } from "tinyld/light"
import type { BackendId } from "./backend"

/**
 * Languages each backend has been eval-approved for (eval/messages.jsonl
 * shows it meets the Spec targets). Widen only with eval results.
 */
export const APPROVED_LANGUAGES: Record<BackendId, readonly string[]> = {
  ollama:  ["en"],
  builtin: ["en"],
  cloud:   ["en"],
}

/** Words that show a message is (at least partly) English: common words and chat slang, not ones shared with other languages ("a", "so", "no"…) */
const ENGLISH = new Set(`
about after again all also always and any are around ask at away back bad be because been before being best better big
bit both but by call came can cant could day did didnt do does doesnt dont done down each even ever every feel few find
first for forgot friend from fun get gets getting give go goes going gone good got great guys had happy hard has have he
hear help her here him his home how i if im into is isnt it its ive just keep kind know last late later least leave left
let life like little live long look lot love made make man many maybe mean more most much must my need never new next nice
night nobody not nothing now of off oh ok okay old once one only or other our out over people please put really right
said same saw say see seen she should show since some someone something soon sorry still stop sure take talk tell than
thank thanks that thats the their them then there these they thing things think this those though thought through time
to today together tomorrow too try two up us very want was way we week well went were what when where which while who why
will with without wont work would wow yeah yes yet you your youre yours yourself hate stupid dumb idiot shut ugly loser
lol lmao lmfao omg idk tbh rn ngl imo btw brb ur pls plz thx ty bro bruh dude fr deadass lowkey highkey bestie boomer mid
cope ratio vibe vibes slay sus cap bet asked rizz yall gonna wanna gotta kinda sorta absolute behaviour behavior
`.trim().split(/\s+/))

const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-෿฀-๿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/gu

export interface LanguageGuess {
  /** ISO 639-1 code, or "" when it can't say which */
  language: string
  /** Strong enough to skip the check on */
  sure: boolean
}

export function guessLanguage(text: string): LanguageGuess {
  const letters = text.match(/\p{L}/gu) ?? []
  if (!letters.length) return { language: "", sure: false }

  const nonLatin = text.match(NON_LATIN) ?? []
  if (nonLatin.length / letters.length > 0.5) {
    return { language: detect(text) || "", sure: true }
  }

  const words = text.toLowerCase().match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? []
  if (words.length < 3) return { language: "", sure: false }
  const english = words.filter(w => ENGLISH.has(w.replace(/['’]/g, ""))).length
  if (english / words.length >= 1 / 3) return { language: "en", sure: true }

  const [top, ...rest] = detectAll(text)
  if (!top || top.lang === "en") return { language: top?.lang ?? "", sure: false }
  // English close behind: too close to call, so check it
  const en = rest.find(d => d.lang === "en")
  const sure = !en || en.accuracy < top.accuracy / 2
  // Sure it isn't English doesn't mean sure which language it is: short
  // French can score as Finnish. Name it only when it's clearly ahead.
  const named = top.accuracy >= 0.1 && (!rest[0] || top.accuracy >= 1.4 * rest[0].accuracy)
  return { language: named ? top.lang : "", sure }
}

/**
 * The language to report when `backend` shouldn't check this message, or
 * null when it should be checked.
 */
export function unsupportedLanguage(text: string, backend: BackendId): string | null {
  const guess = guessLanguage(text)
  if (!guess.sure || APPROVED_LANGUAGES[backend].includes(guess.language)) return null
  return guess.language || "unknown"
}
