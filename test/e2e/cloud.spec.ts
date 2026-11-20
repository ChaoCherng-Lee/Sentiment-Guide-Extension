import type { Page, Worker } from "@playwright/test"
import { badge, countModelCalls, expect, HARSH, openWhatsApp, test, useCloud } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")

const bodies = (worker: Worker) =>
  worker.evaluate(() => (globalThis as unknown as { __cloudBodies: Record<string, unknown>[] }).__cloudBodies)

test("the cloud check flags a harsh message, and never sees the chat", async ({ page, worker }) => {
  await useCloud(worker)
  const ollamaCalls = await countModelCalls(worker)
  // Chat context is on: it still mustn't reach the cloud
  await worker.evaluate(async () => {
    const g = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    const { settings } = await g.chrome.storage.sync.get("settings") as { settings?: object }
    await g.chrome.storage.sync.set({ settings: { ...settings, chatContext: true, chatContextOffered: true } })
  })
  await openWhatsApp(page)

  await box(page).pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator("#suggestion")).toHaveText("I'm frustrated, can we talk later?")

  const sent = await bodies(worker)
  expect(sent.map(b => b.task)).toEqual(expect.arrayContaining(["verdict", "advice"]))
  expect(sent.every(b => !("recent" in b))).toBe(true)
  expect(await ollamaCalls()).toBe(0)
})

test("when the hourly limit is reached, the badge says so", async ({ page, worker }) => {
  await useCloud(worker, { limited: true })
  await openWhatsApp(page)
  await box(page).pressSequentially(HARSH)
  await expect(badge(page)).toHaveAttribute("data-state", "limit")
  await expect(badge(page)).toHaveAttribute("title", /this hour's limit/)
  await expect(popup(page)).toBeHidden()
})
