import path from "node:path"
import { expect, HARSH, setSettings, test } from "./fixtures"

// Plan 12.3: a selectors file sent out after WhatsApp changed its page lets
// the WhatsApp adapter itself find the new box (no fallback, no report).
// The signature check is unit-tested; here the file is already kept.

test("selectors kept from the remote file find a box the built-in ones miss", async ({ context, page, worker }) => {
  await setSettings(worker, { diagnostics: true })
  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    await chrome.storage.local.set({
      remoteSelectors: {
        version: 1, issued: new Date().toISOString(), signature: "checked by the worker",
        selectors: { whatsapp: { compose: [".conversation-v2 .composer[contenteditable]"] } },
      },
    })
  })
  await context.route("https://web.whatsapp.com/changed", route =>
    route.fulfill({ path: path.resolve("test/fixtures/whatsapp-changed.html") }))
  await page.goto("https://web.whatsapp.com/changed")

  const box = page.locator("#box")
  // Found straight away, before anything is typed: the WhatsApp adapter's own box
  await box.click()
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveCount(1)
  await box.pressSequentially(HARSH)
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveAttribute("data-state", "flagged")

  const counts = await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    const days = (await chrome.storage.local.get("diagnostics")).diagnostics as { counts: Record<string, number> }[] | undefined
    return Object.assign({}, ...(days ?? []).map(d => d.counts)) as Record<string, number>
  })
  expect(counts["adapter-broken.whatsapp"]).toBeUndefined()
})
