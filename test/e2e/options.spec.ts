import { expect, sitesReady, test } from "./fixtures"
import { OPTIONAL_SITES } from "../../src/platforms/sites"

// The e2e build starts with every optional site allowed (Playwright can't
// click Chrome's permission prompt), so the switches show as on.
test("the options page lists each optional site with its switch", async ({ context, worker, extensionId }) => {
  await sitesReady(worker)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  const [options] = await Promise.all([context.waitForEvent("page"), page.locator("#openSites").click()])
  await expect(options).toHaveURL(/options\.html/)
  await expect(options.locator(".site h2").first()).toHaveText("WhatsApp Web")
  for (const site of OPTIONAL_SITES) {
    await expect(options.locator(`#site-${site.id}`)).toBeChecked()
  }
})
