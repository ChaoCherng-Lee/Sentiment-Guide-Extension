import { defineConfig } from "@playwright/test"

// End-to-end tests load the e2e build (.output/chrome-mv3-e2e) into
// Chromium against fixture pages. `npm run test:e2e` builds it first.
//
// Most tests use a stand-in model (see fakeModel in test/e2e/fixtures.ts),
// so they're quick and can run side by side. The few marked "with the real
// model" talk to the local Ollama; they run afterwards, one at a time, so
// nothing else competes with the model (one of them measures timing).
const REAL = /with the real model/

export default defineConfig({
  testDir: "test/e2e",
  timeout: 300_000,
  expect: { timeout: 150_000 },
  workers: 3,
  reporter: "list",
  projects: [
    { name: "app", grepInvert: REAL },
    { name: "real-model", grep: REAL, workers: 1, dependencies: ["app"] },
    // Store screenshots (Plan 12.4): only with `npm run screenshots`
    { name: "store", testDir: "test/store" },
  ],
})
