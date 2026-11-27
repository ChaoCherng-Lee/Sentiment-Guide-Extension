import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, HARSH, openWhatsApp, setSettings, sitesReady, test } from "../e2e/fixtures"

// Plan 12.4: the store screenshots, 1280 × 800, from the test pages and the
// stand-in model. `npm run screenshots` writes them to store/screenshots/.
// Skipped in an ordinary test run.

test.skip(process.env.npm_lifecycle_event !== "screenshots", "only with npm run screenshots")
test.use({ viewport: { width: 1280, height: 800 } })

const OUT = path.resolve("store/screenshots")
const shoot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, name) })

test("1: a flagged comment with the card and its rewrites", async ({ page, worker }) => {
  await sitesReady(worker)
  await setSettings(worker, { pauseRedSends: false })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("https://www.reddit.com/")
  await page.locator("#box").click()
  await page.keyboard.type(HARSH)
  await expect(page.locator("#sg-popup-host .rewrite-choice").first()).toBeVisible()
  await shoot(page, "1-card.png")
})

test("2: a harsh WhatsApp message, flagged", async ({ page, worker }) => {
  await setSettings(worker, { pauseRedSends: false })
  await page.setViewportSize({ width: 1280, height: 800 })
  await openWhatsApp(page)
  const box = page.locator('footer [contenteditable="true"]').first()
  await box.click()
  await page.keyboard.type(HARSH)
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveAttribute("data-state", "flagged")
  await expect(page.locator(".sg-highlight").first()).toBeVisible()
  await page.keyboard.press("Escape")
  await page.mouse.move(0, 0)
  await shoot(page, "2-whatsapp.png")
})

test("3: choosing where checks happen", async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)
  await page.waitForLoadState("networkidle")
  await shoot(page, "3-where.png")
})

test("4: Settings, Privacy", async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`chrome-extension://${extensionId}/options.html#privacy`)
  await expect(page.locator("#privacyWhere")).not.toHaveText("Checking…")
  await shoot(page, "4-privacy.png")
})
