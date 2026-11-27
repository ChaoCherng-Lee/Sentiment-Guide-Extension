import type { Page } from "@playwright/test"
import { expect, HARSH, openWhatsApp, recordModelRequests, test } from "./fixtures"

const popup = (page: Page) => page.locator("#sg-popup-host .popup")
const offer = (page: Page) => popup(page).locator("#offer")
const box   = (page: Page) => page.locator("footer [contenteditable]")

/** A short chat with a name, a phone number and a photo in it. */
async function seedChat(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { addIncoming(t: string): void; addOutgoing(t: string): void }
    w.addIncoming("hey it's Alex, my new number is 0412 345 678")
    w.addOutgoing("ok saved")
    w.addIncoming("")   // a photo
    w.addIncoming("did you finish the essay?")
  })
}

test("chat context is off by default and offered once, after the first flag", async ({ page, worker }) => {
  const sent = await recordModelRequests(worker)
  await openWhatsApp(page)
  await seedChat(page)

  await box(page).pressSequentially(HARSH)
  await expect(offer(page)).toBeVisible()
  await expect(popup(page).locator("#context-note")).toBeHidden()
  expect((await sent()).some(t => t.includes("Recent conversation"))).toBe(false)

  await popup(page).locator("#offer-no").click()
  await expect(popup(page).locator("#offer-done")).toContainText("only your own message")
  await popup(page).locator("#dismiss").click()

  // The next flag doesn't offer again
  await box(page).press("Control+a")
  await box(page).press("Delete")
  await box(page).pressSequentially("you're such an idiot, nobody asked you")
  await expect(popup(page)).toBeVisible()
  await expect(offer(page)).toBeHidden()
  expect((await sent()).some(t => t.includes("Recent conversation"))).toBe(false)
})

test("turning it on re-checks with the last messages, scrubbed, and says so", async ({ page, worker, extensionId }) => {
  const sent = await recordModelRequests(worker)
  await openWhatsApp(page)
  await seedChat(page)

  await box(page).pressSequentially(HARSH)
  await expect(offer(page)).toBeVisible()
  await popup(page).locator("#offer-yes").click()

  await expect.poll(async () => (await sent()).find(t => t.includes("Recent conversation")) ?? "", { timeout: 30_000 })
    .toContain("Them: hey it's Them, my new number is [phone]\nMe: ok saved\nThem: did you finish the essay?")
  const withChat = (await sent()).find(t => t.includes("Recent conversation"))!
  expect(withChat).not.toContain("Alex")
  expect(withChat).not.toContain("0412")
  expect(withChat).not.toContain("10:30")   // bubble times stay out

  // Still flagged: the popup says the chat was used, and doesn't offer again
  await expect(popup(page).locator("#context-note")).toBeVisible({ timeout: 30_000 })
  await expect(offer(page)).toBeHidden()

  // Settings shows it's on
  const menu = await page.context().newPage()
  await menu.goto(`chrome-extension://${extensionId}/options.html#general`)
  await expect(menu.locator("#chatContext")).toBeChecked()
  await expect(menu.locator("#chatContextSub")).toContainText("never saved")
})
