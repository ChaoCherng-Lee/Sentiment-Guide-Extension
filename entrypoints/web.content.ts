import { defineContentScript } from "#imports"
import { startEngine } from "../src/engine/engine"
import { ALL_WEBSITES } from "../src/platforms/sites"
import { web } from "../src/platforms/web"

// Every other website. Registered by the background worker only while the
// user allows "All websites" (optional host permission), and never on the
// sites that have their own script (see ALL_WEBSITES.excludeMatches).
export default defineContentScript({
  matches: ALL_WEBSITES.origins,
  registration: "runtime",
  main() {
    startEngine(web)
  },
})
