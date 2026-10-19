import { defineContentScript } from "#imports"
import { startEngine } from "../src/engine/engine"
import { gmail } from "../src/platforms/gmail"

// Registered by the background worker only once the user allows Gmail in
// the options page (optional host permission), so not listed in the manifest.
export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  registration: "runtime",
  main() {
    startEngine(gmail)
  },
})
