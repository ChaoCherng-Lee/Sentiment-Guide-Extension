import { expect, sitesReady, test } from "./fixtures"

test("password, card, code and address fields, and login forms, get no badge", async ({ page, worker }) => {
  await sitesReady(worker)
  await page.goto("https://example.org/")
  const fields = page.locator(".sensitive")
  await expect(fields).toHaveCount(5)
  for (let i = 0; i < 5; i++) {
    await fields.nth(i).click()
    await page.keyboard.type("you are so stupid")
  }
  await page.waitForTimeout(1500)
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveCount(0)
  await expect(page.locator(".sg-highlight")).toHaveCount(0)

  // An ordinary box on the same page is still checked
  await page.locator("#comment-box").click()
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveCount(1)
})

test("a bank's website is off until it's turned on from the badge", async ({ page, worker }) => {
  await sitesReady(worker)
  await page.goto("https://www.examplebank.com/")
  await page.locator("#comment-box").click()
  const badge = page.locator(".sg-badge-host .badge.visible")
  await expect(badge).toHaveAttribute("data-state", "chat-off")
  await badge.click()
  await page.locator(".sg-badge-host").getByRole("menuitem", { name: "Turn on for this site" }).click()
  await page.locator("#comment-box").click()
  await page.keyboard.type("you are so stupid")
  await expect(badge).toHaveAttribute("data-state", "flagged")
})
