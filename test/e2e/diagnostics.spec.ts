import path from "node:path"
import type { Worker } from "@playwright/test"
import { expect, HARSH, setSettings, storedSettings, test } from "./fixtures"

// Plan 12.2: opt-in diagnostics and adapter health

const diagnostics = (worker: Worker) => worker.evaluate(async () => {
  const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
  const days = (await chrome.storage.local.get("diagnostics")).diagnostics as { counts: Record<string, number> }[] | undefined
  return Object.assign({}, ...(days ?? []).map(d => d.counts)) as Record<string, number>
})

async function openChangedWhatsApp(context: import("@playwright/test").BrowserContext, page: import("@playwright/test").Page) {
  // Registered last, so it wins over the usual WhatsApp test page
  await context.route("https://web.whatsapp.com/changed", route =>
    route.fulfill({ path: path.resolve("test/fixtures/whatsapp-changed.html") }))
  await page.goto("https://web.whatsapp.com/changed")
}

test("when WhatsApp's page changes, the box is still checked, and it's counted only with diagnostics on", async ({ context, page, worker }) => {
  await setSettings(worker, { diagnostics: true })
  await openChangedWhatsApp(context, page)
  const box = page.locator("#box")
  await box.click()
  await box.pressSequentially(HARSH)
  // The WhatsApp adapter missed it; the generic one checks it instead
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveAttribute("data-state", "flagged")
  await expect(page.locator("#sg-popup-host .popup")).toBeVisible()

  await expect.poll(() => diagnostics(worker)).toMatchObject({ "adapter-broken.whatsapp": 1, "flag.red.chat": 1 })
  const counts = await diagnostics(worker)
  expect(Object.keys(counts).some(k => k.startsWith("check."))).toBe(true)
  // Only fixed words: nothing of the message, nothing of the site's address
  expect(JSON.stringify(counts)).not.toMatch(/stupid|shut|whatsapp\.com|web\./)
})

test("with diagnostics off (the default), nothing is counted", async ({ context, page, worker }) => {
  await openChangedWhatsApp(context, page)
  const box = page.locator("#box")
  await box.click()
  await box.pressSequentially(HARSH)
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveAttribute("data-state", "flagged")
  await page.waitForTimeout(500)
  expect(await diagnostics(worker)).toEqual({})
})

test("the Privacy tab has the diagnostics switch, off by default", async ({ context, worker, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html#privacy`)
  const toggle = page.locator("#diagnostics")
  await expect(toggle).not.toBeChecked()
  await page.locator("label.switch:has(#diagnostics)").click()
  await expect.poll(async () => (await storedSettings(worker)).diagnostics).toBe(true)
})
