import type { Page, Worker } from "@playwright/test"
import { expect, HARSH, recordModelRequests, sitesReady, test } from "./fixtures"

const reply = (page: Page) => page.locator('#reply [aria-label="Message Body"]')
const popup = (page: Page) => page.locator("#sg-popup-host .popup")
const sent  = (page: Page) => page.evaluate(() => (window as unknown as { sent: string[] }).sent)

async function openGmail(page: Page, worker: Worker) {
  await sitesReady(worker)
  await page.goto("https://mail.google.com/mail/u/0/#inbox/thread1")
}

/** Put the caret at the start of the reply, above the quoted email. */
async function startReply(page: Page) {
  await reply(page).click()
  await reply(page).press("Control+Home")
}

test("checks the paragraph being written, and Replace all changes only that paragraph", async ({ page, worker }) => {
  const turns = await recordModelRequests(worker)
  await openGmail(page, worker)
  await startReply(page)
  await page.keyboard.type("Hi Alex,")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Enter")
  await page.keyboard.type(HARSH)

  await expect(popup(page)).toBeVisible()
  const checked = (await turns()).at(-1)!
  expect(checked).toContain(`"""\n${HARSH}\n"""`)
  expect(checked).not.toContain("Hi Alex")
  expect(checked).not.toContain("such an idiot sometimes")   // the quoted email isn't checked

  await expect(popup(page).locator("#accept")).toBeVisible({ timeout: 60_000 })
  const rewrite = (await popup(page).locator("#suggestion").textContent())!.trim()
  await popup(page).locator("#accept").click()
  await expect(reply(page)).not.toContainText("stupid")
  const text = await reply(page).innerText()
  expect(text.startsWith("Hi Alex,")).toBe(true)
  // The model's apostrophes may be typographic in the popup
  expect(text.replace(/[‘’]/g, "'")).toContain(rewrite.replace(/[‘’]/g, "'").slice(0, 30))
  expect(text).toContain("On Sat, Alex wrote")
})

test("Send checks the whole email first; a flagged one waits until 'Send anyway'", async ({ page, worker }) => {
  await openGmail(page, worker)
  await startReply(page)
  await page.keyboard.type(HARSH, { delay: 0 })
  await page.locator('#reply [data-tooltip^="Send"]').click()

  await expect(popup(page).locator("#send-anyway")).toBeVisible({ timeout: 30_000 })
  expect(await sent(page)).toEqual([])

  await popup(page).locator("#send-anyway").click()
  await expect.poll(() => sent(page)).toEqual([HARSH])
  await expect(popup(page)).toBeHidden()
})

test("a friendly email goes out after the check", async ({ page, worker }) => {
  await openGmail(page, worker)
  await startReply(page)
  await page.keyboard.type("Thanks, see you Saturday! I'll bring the game.", { delay: 0 })
  await page.keyboard.press("Control+Enter")
  await expect.poll(() => sent(page), { timeout: 30_000 }).toEqual(["Thanks, see you Saturday! I'll bring the game."])
})

test("a second compose window is checked on its own, in Formal style, with no context form", async ({ page, worker }) => {
  await openGmail(page, worker)
  await page.locator("#compose-btn").click()
  const body = page.locator('[role="dialog"] [aria-label="Message Body"]')
  await body.click()
  await page.keyboard.type(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator('.style-chip[data-style="formal"]')).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator("#sg-context-host")).toHaveCount(0)
})
