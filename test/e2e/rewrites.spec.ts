import type { Page } from "@playwright/test"
import { expect, HARSH, openWhatsApp, test } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")

test("the card offers a few rewrites, and the one picked is used", async ({ page }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially(HARSH)
  const choices = popup(page).locator(".rewrite-choice")
  await expect(choices).toHaveCount(3)
  await expect(choices.first()).toHaveAttribute("aria-checked", "true")

  await choices.nth(1).click()
  await expect(choices.nth(1)).toHaveAttribute("aria-checked", "true")
  await expect(choices.first()).toHaveAttribute("aria-checked", "false")
  await popup(page).locator("#accept").click()
  await expect(box(page)).toHaveText("I'm really annoyed right now, give me a minute")
})
