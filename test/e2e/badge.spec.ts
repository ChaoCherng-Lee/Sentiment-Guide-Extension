import type { Page } from "@playwright/test"
import { badge, expect, HARSH, openWhatsApp, setOllamaDown, test } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")
const menu  = (page: Page) => page.locator(".sg-badge-host .menu").first()

test("the badge shows a fine message as fine, and a harsh one as flagged", async ({ page }) => {
  await openWhatsApp(page)
  await expect(badge(page)).toHaveAttribute("data-state", "idle")

  await box(page).pressSequentially("see you at 5 then")
  await expect(badge(page)).toHaveAttribute("data-state", "fine")
  await expect(badge(page)).toHaveAttribute("title", "Sounds fine")

  await box(page).press("Control+a")
  await box(page).press("Delete")
  await expect(badge(page)).toHaveAttribute("data-state", "idle")

  // Red: flagged, and the card opens by itself
  await box(page).pressSequentially(HARSH)
  await expect(badge(page)).toHaveAttribute("data-state", "flagged")
  await expect(badge(page)).toHaveAttribute("data-tone", "red")
  await expect(popup(page)).toBeVisible()
})

test("a yellow flag waits to be looked at: the badge or the underline opens it, and × keeps it", async ({ page }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially("you're so lazy")
  await expect(badge(page)).toHaveAttribute("data-tone", "yellow")
  await expect(page.locator(".sg-highlight").first()).toBeVisible()
  await page.waitForTimeout(1_000)
  await expect(popup(page)).toBeHidden()

  // The badge opens the card
  await badge(page).click()
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator(".edit-row")).toHaveCount(1)

  // × only closes it: still flagged and underlined
  await popup(page).locator("#close").click()
  await expect(popup(page)).toBeHidden()
  await expect(badge(page)).toHaveAttribute("data-tone", "yellow")
  await expect(page.locator(".sg-highlight").first()).toBeVisible()

  // Resting the pointer on the underlined words opens it again
  const mark = await page.locator(".sg-highlight").first().boundingBox()
  await page.mouse.move(mark!.x + mark!.width / 2, mark!.y + mark!.height / 2)
  await expect(popup(page)).toBeVisible()

  // Rarer actions sit behind ⋯
  await expect(popup(page).locator("#disable-chat")).toBeHidden()
  await popup(page).locator("#more").click()
  await expect(popup(page).locator("#disable-chat")).toBeVisible()
  await expect(popup(page).locator("#edit-context")).toBeVisible()
  await expect(popup(page).locator("#open-settings")).toBeVisible()
})

test("the badge's menu pauses checking", async ({ page }) => {
  await openWhatsApp(page)
  await badge(page).click()
  await expect(menu(page)).toBeVisible()
  await menu(page).locator("button[data-action='pause']").click()
  await expect(badge(page)).toHaveAttribute("data-state", "paused")

  await badge(page).click()
  await menu(page).locator("button[data-action='resume']").click()
  await expect(badge(page)).toHaveAttribute("data-state", "idle")
})

test("when the AI isn't running, the badge says so and opens the setup page", async ({ page, context, worker }) => {
  await setOllamaDown(worker, true)
  await openWhatsApp(page)
  await expect(badge(page)).toHaveAttribute("data-state", "offline")
  await expect(badge(page)).toHaveAttribute("title", /isn't running/)

  const setup = context.waitForEvent("page")
  await badge(page).click()
  expect((await setup).url()).toContain("/onboarding.html")
})
