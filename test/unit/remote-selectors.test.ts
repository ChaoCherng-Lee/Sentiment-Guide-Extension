import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { browser } from "wxt/browser"
import {
  canonical, loadRemoteSelectors, selectorsFor, type SelectorSet, updateSelectors, validSelectorSet, verifySelectorFile,
} from "../../src/platforms/remote-selectors"

const SELECTORS: SelectorSet = { whatsapp: { compose: [".composer[contenteditable]"] } }

let publicKey: JsonWebKey
let otherKey: JsonWebKey
let privateKey: CryptoKey

async function sign(body: { version: number; issued: string; selectors: unknown }, key = privateKey) {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(canonical(body)))
  return { ...body, signature: Buffer.from(sig).toString("base64") }
}

const file = (version: number, selectors: unknown = SELECTORS) => sign({ version, issued: new Date().toISOString(), selectors })
const serve = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch

beforeAll(async () => {
  const pair  = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  privateKey = pair.privateKey
  publicKey  = await crypto.subtle.exportKey("jwk", pair.publicKey)
  otherKey   = await crypto.subtle.exportKey("jwk", other.publicKey)
})

describe("remote selectors", () => {
  it("accepts a file signed with the key, newer than the one kept", async () => {
    expect(await verifySelectorFile(await file(2), publicKey, 1)).not.toBeNull()
  })

  it("refuses a changed file, another key's signature, an older version and a file from the future", async () => {
    const tampered = { ...(await file(2)), selectors: { whatsapp: { compose: ["body"] } } }
    expect(await verifySelectorFile(tampered, publicKey)).toBeNull()
    expect(await verifySelectorFile(await file(2), otherKey)).toBeNull()
    expect(await verifySelectorFile(await file(2), publicKey, 2)).toBeNull()
    const future = await sign({ version: 3, issued: new Date(Date.now() + 3 * 86400_000).toISOString(), selectors: SELECTORS })
    expect(await verifySelectorFile(future, publicKey)).toBeNull()
  })

  it("takes data only: known sites and keys, short selector strings", () => {
    expect(validSelectorSet(SELECTORS)).toBe(true)
    expect(validSelectorSet({ evil: { compose: ["div"] } })).toBe(false)
    expect(validSelectorSet({ whatsapp: { script: ["div"] } })).toBe(false)
    expect(validSelectorSet({ whatsapp: { compose: ["div{background:url(x)}"] } })).toBe(false)
    expect(validSelectorSet({ whatsapp: { compose: ["<script>"] } })).toBe(false)
    expect(validSelectorSet({ whatsapp: { compose: [42] } })).toBe(false)
  })

  it("keeps a good file, then ignores the same version and a bad one", async () => {
    expect(await updateSelectors("https://x/s.json", publicKey, serve(await file(5)))).toBe("updated")
    expect(await updateSelectors("https://x/s.json", publicKey, serve(await file(5)))).toBe("unchanged")
    expect(await updateSelectors("https://x/s.json", publicKey, serve({ ...(await file(6)), signature: "AAAA" }))).toBe("rejected")
    expect(await updateSelectors("https://x/s.json", publicKey, (async () => new Response("", { status: 500 })) as unknown as typeof fetch)).toBe("failed")
    expect(((await browser.storage.local.get("remoteSelectors")).remoteSelectors as { version: number }).version).toBe(5)
  })

  it("pages try the remote selectors first, then the built-in ones, skipping ones that don't parse", async () => {
    expect(selectorsFor("whatsapp", "compose", ["footer [contenteditable]"])).toEqual(["footer [contenteditable]"])
    await browser.storage.local.set({ remoteSelectors: await file(1, { whatsapp: { compose: [".new-box", "div[[["] } }) })
    await loadRemoteSelectors()
    expect(selectorsFor("whatsapp", "compose", ["footer [contenteditable]"])).toEqual([".new-box", "footer [contenteditable]"])
    expect(selectorsFor("gmail", "compose", ["div.Am"])).toEqual(["div.Am"])
  })

  it("the signing script makes keys and signs files the extension accepts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sg-selectors-"))
    const out = execFileSync("node", ["scripts/selectors.mjs", "keygen", path.join(dir, "key.jwk")], { encoding: "utf8" })
    const key = JSON.parse(/WXT_SELECTORS_PUBLIC_KEY='(.+)'/.exec(out)![1]) as JsonWebKey
    writeFileSync(path.join(dir, "in.json"), JSON.stringify({ version: 7, selectors: SELECTORS }))
    execFileSync("node", ["scripts/selectors.mjs", "sign", path.join(dir, "in.json"), path.join(dir, "key.jwk"), path.join(dir, "out.json")])
    const signed = JSON.parse(readFileSync(path.join(dir, "out.json"), "utf8"))
    expect(await verifySelectorFile(signed, key)).not.toBeNull()
  })
})
