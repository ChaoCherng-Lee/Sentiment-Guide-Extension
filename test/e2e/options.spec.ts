import { expect, setSettings, sitesReady, storedSettings, test, useCloud } from "./fixtures"
import { OPTIONAL_SITES } from "../../src/platforms/sites"

test("the toolbar popup keeps to the quick things and opens Settings", async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(page.locator("#enabled")).toBeChecked()
  await expect(page.locator("#statusText")).toHaveText("The AI is ready")
  await expect(page.locator("#setupBtn")).toBeHidden()
  await expect(page.locator("#weekLine")).toHaveText("This week: nothing flagged so far 🌱")
  // Style and the other choices live in Settings now
  await expect(page.locator("#style")).toHaveCount(0)

  const [options] = await Promise.all([context.waitForEvent("page"), page.locator("#openSettings").click()])
  await expect(options).toHaveURL(/options\.html/)
  await expect(options.locator("#tab-general")).toHaveAttribute("aria-selected", "true")
  await expect(options.locator("#style")).toBeVisible()
})

// The e2e build starts with every optional site allowed (Playwright can't
// click Chrome's permission prompt), so the switches show as on.
test("Settings lists each site with its switch, and the sites switched off", async ({ context, worker, extensionId }) => {
  await sitesReady(worker)
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  await options.locator("#tab-sites").click()
  await expect(options).toHaveURL(/#sites$/)
  await expect(options.locator("#general")).toBeHidden()
  await expect(options.locator(".site h2").first()).toHaveText("WhatsApp Web")
  for (const site of OPTIONAL_SITES) {
    await expect(options.locator(`#site-${site.id}`)).toBeChecked()
  }
  await expect(options.locator("#offEmpty")).toBeVisible()

  // A site switched off from its text box shows up here, and can be turned back on
  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    const settings = (await chrome.storage.sync.get("settings")).settings ?? {}
    await chrome.storage.sync.set({ settings: { ...settings, disabledSites: ["example.org", "mail.google.com"] } })
  })
  await expect(options.locator("#offList li")).toHaveCount(2)
  await expect(options.locator("#site-gmail")).not.toBeChecked()
  await options.getByRole("button", { name: "Turn checking back on for mail.google.com" }).click()
  await expect(options.locator("#offList li")).toHaveCount(1)
  await expect(options.locator("#site-gmail")).toBeChecked()
})

test("The AI tab says whether it's ready", async ({ context, extensionId }) => {
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html#ai`)
  await expect(options.locator("#statusText")).toContainText("gemma3:4b")
  // Every backend is listed with how it stands, and the one in use is chosen
  await expect(options.locator("#backend-ollama")).toBeChecked()
  await expect(options.locator("#status-ollama")).toContainText("gemma3:4b")
})

test("The AI tab switches where checks happen, only when asked", async ({ context, worker, extensionId }) => {
  await useCloud(worker)
  await setSettings(worker, { backend: "ollama" })
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html#ai`)
  await expect(options.locator("#status-cloud")).toHaveText("Ready")
  await expect(options.locator("#backend-ollama")).toBeChecked()
  await options.locator("#backend-cloud").check()
  await expect.poll(async () => (await storedSettings(worker)).backend).toBe("cloud")
  await expect(options.locator("#statusText")).toContainText("private cloud check")
})
