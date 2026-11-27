// Remote selectors (Plan 12.3): when a site changes its page, new selectors
// can reach everyone without a store update.
//
// A signed JSON file — data only, never code — is fetched once a day by the
// worker (updateSelectors), checked against the public key built into the
// extension, and kept in storage. Pages try its selectors first, then the
// adapter's built-in ones, so a bad or missing file never breaks anything.
//
// File format:
//   { "version": 3, "issued": "2026-11-22T00:00:00Z",
//     "selectors": { "whatsapp": { "compose": ["…"], "title": ["…"], "sendButton": ["…"] }, … },
//     "signature": "<base64 ECDSA P-256 / SHA-256 signature of canonical({version, issued, selectors})>" }
// Signed with `node scripts/selectors.mjs sign` (see README).

import { browser } from "#imports"

export const SITES = ["whatsapp", "instagram", "gmail"] as const
export const KEYS  = ["compose", "title", "sendButton"] as const
export type SelectorSite = typeof SITES[number]
export type SelectorKey  = typeof KEYS[number]
export type SelectorSet  = Partial<Record<SelectorSite, Partial<Record<SelectorKey, string[]>>>>

export interface SelectorFile {
  version: number
  issued: string
  selectors: SelectorSet
  signature: string
}

const STORAGE_KEY   = "remoteSelectors"
const MAX_PER_LIST  = 20
const MAX_LENGTH    = 200
/** Characters a selector never needs: style blocks, markup, statements */
const NOT_A_SELECTOR = /[{}<>;\\]|@import|url\(/i

// ── Checking a file (worker, and tests) ─────────────────────────────────────

/** JSON with keys sorted at every level: the exact bytes that are signed */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

/** Only known sites and keys, short lists of short strings that look like selectors */
export function validSelectorSet(s: unknown): s is SelectorSet {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false
  for (const [site, keys] of Object.entries(s)) {
    if (!(SITES as readonly string[]).includes(site)) return false
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) return false
    for (const [key, list] of Object.entries(keys)) {
      if (!(KEYS as readonly string[]).includes(key)) return false
      if (!Array.isArray(list) || list.length > MAX_PER_LIST) return false
      if (!list.every(x => typeof x === "string" && x.length > 0 && x.length <= MAX_LENGTH && !NOT_A_SELECTOR.test(x))) return false
    }
  }
  return true
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The file if its signature, version and contents check out; otherwise null. */
export async function verifySelectorFile(file: unknown, publicKey: JsonWebKey, newerThan = 0): Promise<SelectorFile | null> {
  if (!file || typeof file !== "object") return null
  const f = file as Partial<SelectorFile>
  if (typeof f.version !== "number" || !Number.isInteger(f.version) || f.version <= newerThan) return null
  if (typeof f.issued !== "string" || Number.isNaN(Date.parse(f.issued))) return null
  // Not from the future (a day's leeway for clocks)
  if (Date.parse(f.issued) > Date.now() + 24 * 3600_000) return null
  if (typeof f.signature !== "string" || !validSelectorSet(f.selectors)) return null
  try {
    const key = await crypto.subtle.importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    const data = new TextEncoder().encode(canonical({ version: f.version, issued: f.issued, selectors: f.selectors }))
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromBase64(f.signature), data)
    return ok ? (f as SelectorFile) : null
  } catch {
    return null
  }
}

/**
 * Fetches the file and keeps it if it checks out and is newer than the one
 * kept. Returns what happened, for logs and tests.
 */
export async function updateSelectors(url: string, publicKey: JsonWebKey, fetchFn: typeof fetch = fetch): Promise<"updated" | "unchanged" | "rejected" | "failed"> {
  let file: unknown
  try {
    const res = await fetchFn(url, { cache: "no-cache" })
    if (!res.ok) return "failed"
    file = await res.json()
  } catch {
    return "failed"
  }
  const kept = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as SelectorFile | undefined
  if (kept && (file as Partial<SelectorFile>)?.version === kept.version) return "unchanged"
  const verified = await verifySelectorFile(file, publicKey, kept?.version ?? 0)
  if (!verified) return "rejected"
  await browser.storage.local.set({ [STORAGE_KEY]: verified })
  return "updated"
}

// ── Using them (pages) ──────────────────────────────────────────────────────

let remote: SelectorSet = {}

/** Whether the browser can use it as a selector (checked in the page, once per string) */
const usable = new Map<string, boolean>()
function parses(sel: string): boolean {
  let ok = usable.get(sel)
  if (ok === undefined) {
    try { document.createDocumentFragment().querySelector(sel); ok = true } catch { ok = false }
    usable.set(sel, ok)
  }
  return ok
}

/** The remote selectors for a site's key, then the built-in ones */
export function selectorsFor(site: SelectorSite, key: SelectorKey, builtIn: string[]): string[] {
  const extra = (remote[site]?.[key] ?? []).filter(parses)
  return extra.length ? [...new Set([...extra, ...builtIn])] : builtIn
}

/** Loads the kept file into this page, and follows updates. `onChange` runs when they change. */
export async function loadRemoteSelectors(onChange?: () => void) {
  const read = (file: SelectorFile | undefined) => { remote = file && validSelectorSet(file.selectors) ? file.selectors : {} }
  try {
    read((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as SelectorFile | undefined)
    onChange?.()
    browser.storage.local.onChanged.addListener(changes => {
      if (!(STORAGE_KEY in changes)) return
      read(changes[STORAGE_KEY].newValue as SelectorFile | undefined)
      onChange?.()
    })
  } catch {
    remote = {}
  }
}
