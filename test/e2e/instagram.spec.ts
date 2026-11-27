import type { Page, Worker } from "@playwright/test"
import { expect, HARSH, recordModelRequests, sitesReady, test } from "./fixtures"

const THREAD = "https://www.instagram.com/direct/t/340282366841710300949128/"
const box   = (page: Page) => page.locator('[aria-label="Message"]')
const popup = (page: Page) => page.locator("#sg-popup-host .popup")

async function openThread(page: Page, worker: Worker, url = THREAD) {
  await sitesReady(worker)
  await page.goto(url)
  const form = page.locator("#sg-context-host")
  await form.locator("#skip").click({ timeout: 15_000 })
  await expect(form).toHaveCount(0)
}

async function setSettings(worker: Worker, patch: Record<string, unknown>) {
  await worker.evaluate(async (p) => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    const { settings } = await chrome.storage.sync.get("settings")
    await chrome.storage.sync.set({ settings: { ...(settings as object), ...p } })
  }, patch)
}

test("flags a harsh DM and Tab replaces it", async ({ page, worker }) => {
  await openThread(page, worker)
  await box(page).pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator("#accept")).toBeVisible({ timeout: 60_000 })
  const rewrite = (await popup(page).locator("#suggestion").textContent())!.trim()
  await box(page).press("Tab")
  await expect(box(page)).toHaveText(rewrite)
})

test("works out who sent each message from the side it's on", async ({ page, worker }) => {
  const sent = await recordModelRequests(worker)
  await setSettings(worker, { chatContext: true, chatContextOffered: true })
  await openThread(page, worker)
  await page.evaluate(() => {
    const w = window as unknown as { addIncoming(t: string): void; addOutgoing(t: string): void }
    w.addIncoming("did you see what Alex Rivera posted")
    w.addOutgoing("no what")
  })
  await box(page).pressSequentially(HARSH)
  await expect.poll(async () => (await sent()).find(t => t.includes("Recent conversation")) ?? "", { timeout: 30_000 })
    .toContain("Them: did you see what Them posted\nMe: no what")
})

test("stays out of pages that aren't a DM thread, and out of the search box", async ({ page, worker }) => {
  const sent = await recordModelRequests(worker)
  await sitesReady(worker)
  await page.goto("https://www.instagram.com/explore/")
  await box(page).pressSequentially(HARSH + ".")
  await page.locator('[aria-label="Search"]').pressSequentially(" you idiot.")
  await page.waitForTimeout(3000)
  await expect(popup(page)).toBeHidden()
  expect(await sent()).toEqual([])
})
