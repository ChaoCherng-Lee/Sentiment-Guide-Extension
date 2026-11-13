import type { BrowserContext, Page } from "@playwright/test"
import { badge, expect, HARSH, openWhatsApp, recordModelRequests, test } from "./fixtures"

const SARCASTIC = "wow thanks a lot for ditching me again 🙄"
const NEUTRAL   = "can you send me the homework from today"

const badges = (page: Page) => page.locator(".sg-incoming-badge")
const box    = (page: Page) => page.locator("footer [contenteditable]")
const addIncoming = (page: Page, ...texts: string[]) => page.evaluate(ts => {
  for (const t of ts) (window as unknown as { addIncoming(t: string): void }).addIncoming(t)
}, texts)
const isIncoming = (turn: string) => turn.includes("Message they received")

async function turnOnIncoming(context: BrowserContext, extensionId: string) {
  const menu = await context.newPage()
  await menu.goto(`chrome-extension://${extensionId}/popup.html`)
  await menu.locator(".switch:has(#incomingAnalysis)").click()
  await expect(menu.locator("#incomingSub")).toContainText("On")
  await menu.close()
}

test("received messages aren't read until it's switched on", async ({ page, worker }) => {
  const sent = await recordModelRequests(worker)
  await openWhatsApp(page)
  await addIncoming(page, SARCASTIC)
  await page.waitForTimeout(3000)
  await expect(badges(page)).toHaveCount(0)
  expect((await sent()).filter(isIncoming)).toEqual([])
})

test("only the last 3 are read when on; a tricky one gets a badge with a hedged explanation", async ({ page, context, worker, extensionId }) => {
  const sent = await recordModelRequests(worker)
  await openWhatsApp(page)
  await addIncoming(page, "old one", "old two", NEUTRAL, "see you at 5 then", SARCASTIC)
  await turnOnIncoming(context, extensionId)

  await expect(badges(page)).toHaveCount(1, { timeout: 60_000 })
  const read = (await sent()).filter(isIncoming)
  expect(read).toHaveLength(3)
  expect(read.some(t => t.includes("old one") || t.includes("old two"))).toBe(false)

  // The badge sits on the sarcastic message, and hovering explains it
  const badge = page.locator(".message-in", { hasText: "ditching" }).locator(".sg-incoming-badge")
  await badge.locator(".dot").hover()
  const tip = badge.locator(".tip")
  await expect(tip).toBeVisible()
  await expect(tip.locator(".expl")).toHaveText(/probably|might|may|maybe|could|perhaps|likely|seem|sound|possibly|hard to say/i)

  // Feedback is counted locally, without any text
  await tip.locator("button[data-helpful='1']").click()
  await expect(tip).toContainText("Thanks")
  const stored = await worker.evaluate(() =>
    (globalThis as unknown as { chrome: typeof import("wxt/browser").browser }).chrome.storage.local.get("incomingFeedback"))
  expect(JSON.stringify(stored)).not.toContain("ditching")
  expect(Object.values(stored.incomingFeedback as Record<string, { helpful: number }>)[0].helpful).toBe(1)

  // A new message is read as it arrives
  await addIncoming(page, "ugh fine. whatever.")
  await expect.poll(async () => (await sent()).filter(isIncoming).length, { timeout: 60_000 }).toBe(4)
})

test.describe("with the real model", () => {
  test.use({ realModel: true })

  test("incoming readings don't hold up an outgoing check", async ({ page, context, worker, extensionId }) => {
    const sent  = await recordModelRequests(worker)
    /** Time from the last keystroke to the flag (yellow or red) on the badge. */
    const timeToFlag = async (text: string, timeout = 30_000) => {
      await box(page).pressSequentially(text, { delay: 0 })
      const start = Date.now()
      await expect(badge(page)).toHaveAttribute("data-state", "flagged", { timeout })
      const ms = Date.now() - start
      await box(page).press("Control+a")
      await box(page).press("Delete")
      await expect(badge(page)).not.toHaveAttribute("data-state", "flagged")
      return ms
    }

    await openWhatsApp(page)
    await timeToFlag("you're useless, nobody asked", 150_000)   // loads the model, which can take a while
    const alone = await timeToFlag(HARSH)

    await turnOnIncoming(context, extensionId)
    await addIncoming(page, SARCASTIC, "you never listen to me", "lol ok")
    await expect.poll(async () => (await sent()).filter(isIncoming).length).toBeGreaterThan(0)
    const busy = await timeToFlag("ugh you're so annoying, just stop talking")

    console.log(`outgoing flag: ${alone} ms alone, ${busy} ms with incoming readings queued`)
    // At most one interrupted model call's worth of slack
    expect(busy).toBeLessThan(alone + 4_000)
  })
})
