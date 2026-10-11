import { type BrowserContext, test as base, chromium } from "@playwright/test"
import path from "node:path"

const EXTENSION = path.resolve(".output/chrome-mv3")
const FIXTURES  = path.resolve("test/fixtures")

/** Sites the extension runs on, served from local fixture pages. */
const SITES: Record<string, string> = {
  "https://web.whatsapp.com/**": "whatsapp.html",
}

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    })
    for (const [pattern, file] of Object.entries(SITES)) {
      await context.route(pattern, route => route.fulfill({ path: path.join(FIXTURES, file) }))
    }
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent("serviceworker")
    if (process.env.SG_DEBUG) worker.on("console", m => console.log("[background]", m.text()))
    await use(worker.url().split("/")[2])
  },
})

export const expect = test.expect
