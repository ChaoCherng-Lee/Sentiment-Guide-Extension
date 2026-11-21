import type { Page } from "@playwright/test"
import { badge, expect, HARSH, openWhatsApp, setSettings, test } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")
const sent  = (page: Page) => page.locator(".message-out")

async function typeRed(page: Page) {
  await box(page).pressSequentially(HARSH)
  await expect(badge(page)).toHaveAttribute("data-state", "flagged")
  await page.keyboard.press("Escape")
}

test("a red message is held on Send, and Send anyway sends it", async ({ page }) => {
  await openWhatsApp(page)
  await typeRed(page)
  const before = await sent(page).count()
  await box(page).press("Enter")
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator("#send-anyway")).toBeVisible()
  await page.waitForTimeout(300)
  expect(await sent(page).count()).toBe(before)

  await popup(page).locator("#send-anyway").click()
  await expect(sent(page).last()).toHaveText(new RegExp(HARSH.slice(0, 20)))
  await expect(box(page)).toHaveText("")
})

test("Ctrl+Enter sends a red message anyway, and the send button is held too", async ({ page }) => {
  await openWhatsApp(page)
  await typeRed(page)
  const before = await sent(page).count()
  await page.locator('[data-icon="send"]').click()
  await expect(popup(page).locator("#send-anyway")).toBeVisible()
  expect(await sent(page).count()).toBe(before)
  await box(page).press("Control+Enter")
  await expect(sent(page)).toHaveCount(before + 1)
})

test("a yellow message isn't held", async ({ page }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially("you're so lazy")
  await expect(badge(page)).toHaveAttribute("data-state", "flagged")
  const before = await sent(page).count()
  await box(page).press("Enter")
  await expect(sent(page)).toHaveCount(before + 1)
})

test("a check that's still running doesn't hold a send for long", async ({ page, worker }) => {
  await openWhatsApp(page)
  await worker.evaluate(() => { (globalThis as unknown as { __modelDelay: number }).__modelDelay = 4000 })
  const before = await sent(page).count()
  await box(page).fill(HARSH)
  const start = Date.now()
  await box(page).press("Enter")
  await expect(sent(page)).toHaveCount(before + 1)
  expect(Date.now() - start).toBeLessThan(2000)
})

test("with the setting off, red messages send straight away", async ({ page, worker }) => {
  await setSettings(worker, { pauseRedSends: false })
  await openWhatsApp(page)
  await typeRed(page)
  const before = await sent(page).count()
  await box(page).press("Enter")
  await expect(sent(page)).toHaveCount(before + 1)
})
