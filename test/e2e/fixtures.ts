import { type BrowserContext, type Page, type Worker, test as base, chromium } from "@playwright/test"
import path from "node:path"

const EXTENSION = path.resolve(".output/chrome-mv3")
const FIXTURES  = path.resolve("test/fixtures")

/** Sites the extension runs on, served from local fixture pages. */
const SITES: Record<string, string> = {
  "https://web.whatsapp.com/**": "whatsapp.html",
}

export const HARSH = "you are so stupid, just shut up already"

/** Launch Chromium with the built extension. `userDataDir` "" = throwaway profile. */
export async function launch(userDataDir = ""): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  })
  for (const [pattern, file] of Object.entries(SITES)) {
    await context.route(pattern, route => route.fulfill({ path: path.join(FIXTURES, file) }))
  }
  return context
}

export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent("serviceworker")
  if (process.env.SG_DEBUG) worker.on("console", m => console.log("[background]", m.text()))
  return worker
}

/** Open the WhatsApp fixture and skip the first-visit context form. */
export async function openWhatsApp(page: Page) {
  await page.goto("https://web.whatsapp.com/")
  const form = page.locator("#sg-context-host")
  await form.locator("#skip").click({ timeout: 15_000 })
  await expect(form).toHaveCount(0)
}

/** Start counting model calls made by the background worker. */
export async function countModelCalls(worker: Worker) {
  await worker.evaluate(() => {
    const g = globalThis as unknown as { fetch: typeof fetch; __modelCalls: number }
    const original = g.fetch
    g.__modelCalls = 0
    g.fetch = (input, init) => {
      if (String(input).includes("/api/chat")) g.__modelCalls++
      return original(input, init)
    }
  })
  return () => worker.evaluate(() => (globalThis as unknown as { __modelCalls: number }).__modelCalls)
}

export const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string }>({
  context: async ({}, use) => {
    const context = await launch()
    await use(context)
    await context.close()
  },
  worker: async ({ context }, use) => {
    await use(await backgroundWorker(context))
  },
  extensionId: async ({ worker }, use) => {
    await use(worker.url().split("/")[2])
  },
})

export const expect = test.expect
