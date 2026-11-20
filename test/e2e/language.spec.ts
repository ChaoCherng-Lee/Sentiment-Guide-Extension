import type { Page } from "@playwright/test"
import { badge, countModelCalls, expect, openWhatsApp, test } from "./fixtures"

const box = (page: Page) => page.locator("footer [contenteditable]")

test("a message in a language the AI isn't tested on says so instead of guessing", async ({ page, worker }) => {
  const calls = await countModelCalls(worker)
  await openWhatsApp(page)
  await box(page).pressSequentially("eres un inútil y nadie te quiere")
  await expect(badge(page)).toHaveAttribute("data-state", "language")
  await expect(badge(page)).toHaveAttribute("title", "Not checked: Spanish isn't supported yet")
  expect(await calls()).toBe(0)

  // Back to English: checked as usual
  await box(page).press("Control+a")
  await box(page).press("Delete")
  await box(page).pressSequentially("see you at 5 then")
  await expect(badge(page)).toHaveAttribute("data-state", "fine")
})
