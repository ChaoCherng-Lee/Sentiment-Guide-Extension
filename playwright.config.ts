import { defineConfig } from "@playwright/test"

// End-to-end tests load the built extension (.output/chrome-mv3) into
// Chromium against fixture pages and talk to the real local Ollama.
// Run `npm run build` first.
export default defineConfig({
  testDir: "test/e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: "list",
})
