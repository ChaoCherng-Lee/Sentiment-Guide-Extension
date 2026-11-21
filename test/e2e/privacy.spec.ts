import { expect, setSettings, storedSettings, test } from "./fixtures"

test("the Privacy tab says what leaves this computer, and deletes everything kept here", async ({ context, worker, extensionId }) => {
  // Something of everything: settings, tally, "It's fine" counts and examples, a chat's answers
  await setSettings(worker, { sensitivity: "strict" })
  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    await chrome.storage.local.set({
      weekStats: { week: "2026-W47", flagged: 3 },
      fineFeedback: { byTone: { yellow: 1, red: 0 } },
      fineExamples: { "site:example.org": [{ text: "you clown", at: 1 }] },
      "chat:abc": { context: { q1: "close_friend" } },
    })
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html#privacy`)
  await expect(page.locator("#privacyWhere")).toContainText("Nothing you write")

  page.once("dialog", d => d.accept())
  await page.locator("#deleteEverything").click()
  await expect(page.locator("#deleteDone")).toBeVisible()

  const local = await worker.evaluate(async () =>
    (globalThis as unknown as { chrome: typeof import("wxt/browser").browser }).chrome.storage.local.get(null))
  expect(Object.keys(local)).toEqual(["onboardingDone"])
  expect((await storedSettings(worker)).sensitivity).toBeUndefined()
})

test("with the cloud check, the Privacy tab says what is sent", async ({ context, worker, extensionId }) => {
  await setSettings(worker, { backend: "cloud" })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html#privacy`)
  await expect(page.locator("#privacyWhere")).toContainText("sent to the private cloud check")
})
