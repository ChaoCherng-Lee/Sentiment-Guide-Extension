import { defineContentScript } from "#imports"
import { startEngine } from "../src/engine/engine"
import { whatsapp } from "../src/platforms/whatsapp"

export default defineContentScript({
  matches: ["https://web.whatsapp.com/*"],
  main() {
    startEngine(whatsapp)
  },
})
