import type { Page, Worker } from "@playwright/test"
import { badge, expect, HARSH, openWhatsApp, test } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")

const stored = (worker: Worker) => worker.evaluate(() =>
  (globalThis as unknown as { chrome: typeof import("wxt/browser").browser }).chrome.storage.local.get(["fineFeedback", "weekStats"]))

test("'It's fine' leaves the message alone and asks why, without keeping any text", async ({ page, worker }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator("#dismiss")).toHaveText("It's fine")

  await popup(page).locator("#dismiss").click()
  // No longer flagged, but the card asks what it was
  await expect(page.locator(".sg-highlight")).toHaveCount(0)
  await expect(badge(page)).not.toHaveAttribute("data-state", "flagged")
  await expect(popup(page).locator("#fine")).toBeVisible()
  await expect(popup(page).locator("#explanation")).toBeHidden()

  await popup(page).getByRole("button", { name: "A joke between us" }).click()
  await expect(popup(page)).toBeHidden()

  await expect.poll(async () => (await stored(worker)).fineFeedback?.byReason?.joke).toBe(1)
  const s = await stored(worker)
  expect(s.fineFeedback.byTone.red).toBe(1)
  expect(s.weekStats.fine).toBe(1)
  expect(JSON.stringify(s)).not.toContain("stupid")

  // The same message isn't flagged again
  await box(page).press("End")
  await box(page).press("Space")
  await box(page).press("Backspace")
  await page.waitForTimeout(1_500)
  await expect(popup(page)).toBeHidden()
})

test("typing on closes the question, and it counts with no reason", async ({ page, worker }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await popup(page).locator("#dismiss").click()
  await expect(popup(page).locator("#fine")).toBeVisible()

  await box(page).pressSequentially(" ok")
  await expect(popup(page).locator("#fine")).toBeHidden()
  await expect.poll(async () => (await stored(worker)).fineFeedback?.byReason?.none).toBe(1)
})
