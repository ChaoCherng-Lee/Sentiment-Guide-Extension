import { expect, test } from "./fixtures"

const HARSH = "you are so stupid, just shut up already"

test.beforeEach(async ({ page, extensionId }) => {
  expect(extensionId).toBeTruthy()
  await page.goto("https://web.whatsapp.com/")
  // First visit to a chat offers the context form — skip it
  const form = page.locator("#sg-context-host")
  await form.locator("#skip").click({ timeout: 15_000 })
  await expect(form).toHaveCount(0)
})

test("flags a harsh message and Tab replaces it with the suggestion", async ({ page }) => {
  const box = page.locator("footer [contenteditable]")
  await box.pressSequentially(HARSH)

  // Step 1: flagged quickly, with a "thinking" placeholder
  const popup = page.locator("#sg-popup-host .popup")
  await expect(popup).toBeVisible()
  await expect(popup.locator("#explanation.pending")).toBeVisible()
  await expect(page.locator(".sg-highlight").first()).toBeVisible()

  // Step 2: the explanation and rewrite fill in
  await expect(popup.locator("#explanation")).not.toHaveClass(/pending/)
  await expect(popup.locator("#accept")).toBeVisible()
  const suggestion = (await popup.locator("#suggestion").textContent())!.trim()
  expect(suggestion.length).toBeGreaterThan(0)

  await box.press("Tab")
  await expect(box).toHaveText(suggestion)
})

test("sending with the send button clears the popup", async ({ page }) => {
  await page.locator("footer [contenteditable]").pressSequentially(HARSH)
  const popup = page.locator("#sg-popup-host .popup")
  await expect(popup).toBeVisible()

  await page.locator('[data-icon="send"]').click()
  await expect(popup).toBeHidden()
  await expect(page.locator(".sg-highlight")).toHaveCount(0)
})

test("never attaches to the search box", async ({ page }) => {
  await page.locator("#side [contenteditable]").pressSequentially(" " + HARSH)
  await page.waitForTimeout(8_000)
  await expect(page.locator("#sg-popup-host .popup")).toBeHidden()
})
