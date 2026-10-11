import type { Page } from "@playwright/test"
import { HARSH, expect, openWhatsApp, test } from "./fixtures"

const popup = (page: Page) => page.locator("#sg-popup-host .popup")
const styleChip = (page: Page, style: string) => popup(page).locator(`.style-chip[data-style="${style}"]`)

/** Wait for step 2 to finish and return the rewrite. */
async function suggestion(page: Page) {
  await expect(popup(page).locator("#explanation")).not.toHaveClass(/pending/)
  await expect(popup(page).locator("#accept")).toBeVisible()
  return (await popup(page).locator("#suggestion").textContent())!.trim()
}

test("switching style in the popup rewrites the suggestion and is remembered for the chat", async ({ page }) => {
  await openWhatsApp(page)
  const box = page.locator("footer [contenteditable]")
  await box.pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(styleChip(page, "casual")).toHaveAttribute("aria-pressed", "true")
  const casual = await suggestion(page)

  await styleChip(page, "formal").click()
  await expect(styleChip(page, "formal")).toHaveAttribute("aria-pressed", "true")
  await expect(popup(page).locator("#explanation")).toHaveClass(/pending/)
  const formal = await suggestion(page)
  expect(formal).not.toBe(casual)

  // The next flag in this chat starts in Formal
  await page.locator('[data-icon="send"]').click()
  await box.pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(styleChip(page, "formal")).toHaveAttribute("aria-pressed", "true")
})

test("the default style from the toolbar popup is used for new flags", async ({ context, extensionId, page }) => {
  const toolbar = await context.newPage()
  await toolbar.goto(`chrome-extension://${extensionId}/popup.html`)
  await toolbar.locator('#style [data-style="direct"]').click()
  await expect(toolbar.locator('#style [data-style="direct"]')).toHaveAttribute("aria-checked", "true")
  await expect(toolbar.locator("#styleHint")).toContainText("Short and clear")

  await page.bringToFront()
  await openWhatsApp(page)
  await page.locator("footer [contenteditable]").pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(styleChip(page, "direct")).toHaveAttribute("aria-pressed", "true")
})

test("a chat marked formal in the context form starts in Formal", async ({ page }) => {
  await page.goto("https://web.whatsapp.com/")
  const form = page.locator("#sg-context-host")
  for (const [q, value] of [["q1", "teacher"], ["q2", "formal"], ["q3", "no"], ["q4", "no"], ["q5", "normal"]]) {
    await form.locator(`.chip[data-q="${q}"][data-value="${value}"]`).click()
  }
  await form.locator("#save").click()
  await expect(form).toHaveCount(0)

  await page.locator("footer [contenteditable]").pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(styleChip(page, "formal")).toHaveAttribute("aria-pressed", "true")
})
