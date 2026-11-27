import type { Page, Worker } from "@playwright/test"
import { badge, countModelCalls, expect, HARSH, openWhatsApp, test, useBuiltinAI } from "./fixtures"

const box   = (page: Page) => page.locator("footer [contenteditable]")
const popup = (page: Page) => page.locator("#sg-popup-host .popup")

const builtinPrompts = (worker: Worker) =>
  worker.evaluate(() => (globalThis as unknown as { __builtinPrompts: number }).__builtinPrompts)

test("checks run on Chrome's built-in AI when it's the chosen backend", async ({ page, worker }) => {
  await useBuiltinAI(worker)
  await openWhatsApp(page)

  await box(page).pressSequentially("see you at 5 then")
  await expect(badge(page)).toHaveAttribute("data-state", "fine")

  await box(page).press("Control+a")
  await box(page).press("Delete")
  await box(page).pressSequentially(HARSH)
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator(".edit-row")).toHaveCount(2)
  // Verdicts and advice both came from the built-in model
  expect(await builtinPrompts(worker)).toBeGreaterThanOrEqual(3)
})

test("before Chrome has downloaded its model, the badge offers setup instead of checking", async ({ page, worker }) => {
  await useBuiltinAI(worker, "downloadable")
  const calls = await countModelCalls(worker)
  await openWhatsApp(page)
  await box(page).click()
  await expect(badge(page)).toHaveAttribute("data-state", "no-model")
  await expect(badge(page)).toHaveAttribute("title", /click to set it up/)
  expect(await builtinPrompts(worker)).toBe(0)
  expect(await calls()).toBe(0)
})
