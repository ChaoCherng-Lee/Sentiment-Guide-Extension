import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { HARSH, backgroundWorker, badge as boxBadge, countModelCalls, expect, launch, openWhatsApp, test } from "./fixtures"

// Code passed to worker.evaluate runs inside the extension, where `chrome` exists
declare const chrome: any

const popup  = (page: import("@playwright/test").Page) => page.locator("#sg-popup-host .popup")
const badge  = (worker: import("@playwright/test").Worker) =>
  worker.evaluate(() => chrome.action.getBadgeText({}))

test("switching off in the toolbar popup stops checks without a reload, and on again resumes", async ({ context, worker, extensionId, page }) => {
  await openWhatsApp(page)
  const calls = await countModelCalls(worker)

  const toolbar = await context.newPage()
  await toolbar.goto(`chrome-extension://${extensionId}/popup.html`)
  await toolbar.locator(".switch:has(#enabled)").click()
  await expect(toolbar.locator("#powerState")).toHaveText("Off")
  await expect.poll(() => badge(worker)).toBe("OFF")

  await page.bringToFront()
  const box = page.locator("footer [contenteditable]")
  await box.pressSequentially(HARSH)
  await page.waitForTimeout(3_000)
  await expect(popup(page)).toBeHidden()
  expect(await calls()).toBe(0)

  await toolbar.locator(".switch:has(#enabled)").click()
  await expect(toolbar.locator("#powerState")).toHaveText("On")
  await expect.poll(() => badge(worker)).toBe("")
  await page.bringToFront()
  await box.pressSequentially(" now")
  await expect(popup(page)).toBeVisible()
})

test("pausing sends no requests to the model and shows when it will resume", async ({ context, worker, extensionId, page }) => {
  await openWhatsApp(page)
  const calls = await countModelCalls(worker)

  const toolbar = await context.newPage()
  await toolbar.goto(`chrome-extension://${extensionId}/popup.html`)
  await toolbar.locator("#pause1h").click()
  await expect(toolbar.locator("#powerState")).toHaveText("Paused")
  await expect(toolbar.locator("#resumeRow")).toBeVisible()
  await expect.poll(() => badge(worker)).toBe("II")
  expect(await worker.evaluate(() => chrome.alarms.get("resume").then((a: unknown) => !!a))).toBe(true)

  await page.bringToFront()
  await expect(boxBadge(page)).toHaveAttribute("data-state", "paused")
  await expect(boxBadge(page)).toHaveAttribute("title", /Paused until/)
  await page.locator("footer [contenteditable]").pressSequentially(HARSH)
  await page.waitForTimeout(3_000)
  await expect(popup(page)).toBeHidden()
  expect(await calls()).toBe(0)

  await toolbar.locator("#resume").click()
  await expect.poll(() => badge(worker)).toBe("")
  await expect(boxBadge(page)).not.toHaveAttribute("data-state", "paused")
})

test("an elapsed pause is cleared by the resume alarm", async ({ worker, page }) => {
  await openWhatsApp(page)
  await worker.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get("settings")
    await chrome.storage.sync.set({ settings: { ...settings, enabled: true, pausedUntil: Date.now() + 1500 } })
  })
  await expect(boxBadge(page)).toHaveAttribute("data-state", "paused")
  // Alarms fire no sooner than ~30 s in unpacked extensions; allow for that
  await expect(boxBadge(page)).not.toHaveAttribute("data-state", "paused", { timeout: 90_000 })
  await expect.poll(() => badge(worker)).toBe("")
})

test("'Don't check this chat' turns checking off for that chat only", async ({ page }) => {
  await openWhatsApp(page)
  const box = page.locator("footer [contenteditable]")
  await box.pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()

  await popup(page).locator("#more").click()
  await popup(page).locator("#disable-chat").click()
  await expect(popup(page)).toBeHidden()
  await expect(boxBadge(page)).toHaveAttribute("data-state", "chat-off")
  await expect(boxBadge(page)).toHaveAttribute("title", "Not checking this chat")

  // Another chat is still checked (its context form appears first)
  await page.locator("#chat-sam").click()
  await page.locator("#sg-context-host #skip").click()
  await expect(boxBadge(page)).not.toHaveAttribute("data-state", "chat-off")

  // Back to the first chat: still off; the badge's menu switches it back on
  await page.locator("#chat-alex").click()
  await expect(boxBadge(page)).toHaveAttribute("data-state", "chat-off")
  await boxBadge(page).click()
  await page.locator(".sg-badge-host .menu button[data-action='chat-on']").first().click()
  await expect(boxBadge(page)).not.toHaveAttribute("data-state", "chat-off")
  await box.pressSequentially(" again")
  await expect(popup(page)).toBeVisible()
})

test("a pause survives a browser restart", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "sg-profile-"))
  try {
    let context = await launch(profile)
    let worker  = await backgroundWorker(context)
    const id    = worker.url().split("/")[2]
    const toolbar = await context.newPage()
    await toolbar.goto(`chrome-extension://${id}/popup.html`)
    await toolbar.locator("#pauseTomorrow").click()
    await expect(toolbar.locator("#powerState")).toHaveText("Paused")
    await context.close()

    context = await launch(profile)
    worker  = await backgroundWorker(context)
    await expect.poll(() => badge(worker)).toBe("II")
    const page = await context.newPage()
    await page.goto(`chrome-extension://${id}/popup.html`)
    await expect(page.locator("#powerState")).toHaveText("Paused")
    await expect(page.locator("#powerSub")).toContainText("tomorrow")
    await context.close()
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})
