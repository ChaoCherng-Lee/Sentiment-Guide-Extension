import type { Page } from "@playwright/test"
import { expect, openWhatsApp, test } from "./fixtures"

const MESSAGE = "you are so stupid 😤 just shut up already"

const popup = (page: Page) => page.locator("#sg-popup-host .popup")
const box   = (page: Page) => page.locator("footer [contenteditable]")

/** Caret position in the compose box, as a character offset. */
const caret = (page: Page) => box(page).evaluate(el => {
  const sel = getSelection()!
  const r = document.createRange()
  r.setStart(el, 0)
  r.setEnd(sel.focusNode!, sel.focusOffset)
  return r.toString().length
})

test("applying one edit changes only that phrase and keeps emoji and caret", async ({ page }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially(MESSAGE)
  await expect(popup(page)).toBeVisible()

  const row = popup(page).locator(".edit-row").first()
  await expect(row).toBeVisible({ timeout: 60_000 })
  const from = (await row.locator(".edit-from").textContent())!
  const to   = (await row.locator(".edit-to").textContent())!

  // Caret at the end of the message, as after typing
  const before = await box(page).innerText()
  expect(await caret(page)).toBe(before.length)

  await row.locator(".btn-apply").click()

  const at = before.toLowerCase().indexOf(from.toLowerCase())
  const expected = before.slice(0, at) + to + before.slice(at + from.length)
  await expect(box(page)).toHaveText(expected)
  expect(expected).toContain("😤")
  expect(await caret(page)).toBe(expected.length)
})

test("Replace all and Tab still use the whole rewrite", async ({ page }) => {
  await openWhatsApp(page)
  await box(page).pressSequentially(MESSAGE)
  await expect(popup(page).locator("#accept")).toBeVisible({ timeout: 60_000 })
  await expect(popup(page).locator("#accept")).toHaveText("Replace all (Tab)")
  const rewrite = (await popup(page).locator("#suggestion").textContent())!.trim()

  await box(page).press("Tab")
  await expect(box(page)).toHaveText(rewrite)
})
