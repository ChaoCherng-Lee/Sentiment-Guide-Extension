import type { Page, Worker } from "@playwright/test"
import { badge, expect, HARSH, openWhatsApp, recordModelRequests, test, useCloud } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")

const learned = (worker: Worker) => worker.evaluate(async () =>
  ((await (globalThis as unknown as { chrome: typeof import("wxt/browser").browser }).chrome.storage.local.get("fineExamples"))
    .fineExamples ?? {}) as Record<string, { text: string }[]>)

async function sayItsFine(page: Page, text: string) {
  await box(page).pressSequentially(text)
  await expect(popup(page)).toBeVisible()
  await popup(page).locator("#dismiss").click()
  await popup(page).getByRole("button", { name: "A joke between us" }).click()
  await expect(popup(page)).toBeHidden()
  await box(page).press("Control+a")
  await box(page).press("Delete")
}

test("after 'It's fine', a similar message in the same chat isn't flagged", async ({ page, worker }) => {
  await openWhatsApp(page)
  await sayItsFine(page, HARSH)

  // Kept on this computer, for this chat only
  await expect.poll(async () => Object.values(await learned(worker)).flat().map(e => e.text)).toEqual([HARSH])

  const turns = await recordModelRequests(worker)
  await box(page).pressSequentially("you are so stupid, shut up")
  await expect(badge(page)).toHaveAttribute("data-state", "fine")
  expect((await turns()).at(-1)).toContain(HARSH)

  // Something unlike it is still checked as usual
  await box(page).press("Control+a")
  await box(page).press("Delete")
  await box(page).pressSequentially("what an idiot")
  await expect(popup(page)).toBeVisible()
})

test("what 'It's fine' taught never goes to the cloud check", async ({ page, worker }) => {
  await openWhatsApp(page)
  await sayItsFine(page, HARSH)
  await useCloud(worker)
  await box(page).pressSequentially("you are so stupid, honestly")
  await expect(badge(page)).toHaveAttribute("data-state", "flagged")
  const bodies = await worker.evaluate(() => (globalThis as unknown as { __cloudBodies: unknown[] }).__cloudBodies)
  expect(JSON.stringify(bodies)).not.toContain("just shut up already")
})
