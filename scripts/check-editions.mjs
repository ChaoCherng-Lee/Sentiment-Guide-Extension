// Plan 11.1: the consumer build has no parent pairing or sharing code.
// Builds it into its own folder and looks for the sharing calls' names.
//   npm run check:editions
import { execSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const MARKERS = ["redeem_pairing_code", "delete_my_data", "/auth/v1/", "Shared with parent"]

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

function build(edition) {
  // Each WXT mode builds into its own folder: .output/chrome-mv3-<mode>
  execSync(`npx wxt build --mode edition-${edition}`, { stdio: "ignore", env: { ...process.env, BUILD_EDITION: edition } })
  const code = files(`.output/chrome-mv3-edition-${edition}`).filter(f => f.endsWith(".js")).map(f => readFileSync(f, "utf8")).join("\n")
  return MARKERS.filter(m => code.includes(m))
}

const consumer = build("consumer")
const family   = build("family")
console.log(`consumer: ${consumer.length ? "has " + consumer.join(", ") : "no sharing code"}`)
console.log(`family:   ${family.length} of ${MARKERS.length} sharing markers`)
if (consumer.length || family.length < 2) process.exit(1)
