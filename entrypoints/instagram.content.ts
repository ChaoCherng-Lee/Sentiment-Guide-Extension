import { defineContentScript } from "#imports"
import { startEngine } from "../src/engine/engine"
import { instagram } from "../src/platforms/instagram"

// Registered by the background worker only once the user allows Instagram in
// the options page (optional host permission), so not listed in the manifest.
export default defineContentScript({
  matches: ["https://www.instagram.com/*"],
  registration: "runtime",
  main() {
    startEngine(instagram)
  },
})
