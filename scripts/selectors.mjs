// Plan 12.3: make the signing keys and sign the remote selectors file.
//
//   node scripts/selectors.mjs keygen <private-key.jwk>
//       Makes an ECDSA P-256 key pair. Keep the private key OUT of the
//       repository (a password manager or a secret store). Prints the public
//       key: put it in .env as WXT_SELECTORS_PUBLIC_KEY='…' and rebuild.
//
//   node scripts/selectors.mjs sign <selectors.json> <private-key.jwk> <out.json>
//       selectors.json: { "version": <higher than the last one>, "selectors": { … } }
//       Adds "issued" (now) and "signature". Publish out.json at the address
//       in WXT_SELECTORS_URL, served with Access-Control-Allow-Origin: *
//       (GitHub raw files and most static hosts do).
import { webcrypto as crypto } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

// Same as canonical() in src/platforms/remote-selectors.ts
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

const [command, ...args] = process.argv.slice(2)

if (command === "keygen" && args.length === 1) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
  writeFileSync(args[0], JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)), { mode: 0o600 })
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey)
  console.log(`Private key written to ${args[0]} — keep it out of the repository.`)
  console.log(`Add to .env:\nWXT_SELECTORS_PUBLIC_KEY='${JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y })}'`)
} else if (command === "sign" && args.length === 3) {
  const [input, keyFile, output] = args
  const { version, selectors } = JSON.parse(readFileSync(input, "utf8"))
  if (!Number.isInteger(version) || version < 1) throw new Error("version must be a whole number, higher than the last file's")
  const issued = new Date().toISOString()
  const key = await crypto.subtle.importKey("jwk", JSON.parse(readFileSync(keyFile, "utf8")), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(canonical({ version, issued, selectors })))
  writeFileSync(output, JSON.stringify({ version, issued, selectors, signature: Buffer.from(sig).toString("base64") }, null, 2) + "\n")
  console.log(`Signed version ${version} → ${output}`)
} else {
  console.log("Usage:\n  node scripts/selectors.mjs keygen <private-key.jwk>\n  node scripts/selectors.mjs sign <selectors.json> <private-key.jwk> <out.json>")
  process.exit(1)
}
