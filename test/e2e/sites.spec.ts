import { expect, HARSH, setSettings, sitesReady, test, VERIFIED_SITES } from "./fixtures"

// Plan 10.3 (Spec FR-5.3): the sites people chat on, each with a test page
// using that site's own editor markup (Slate, Lexical, Draft.js, Quill…).

for (const site of VERIFIED_SITES) {
  test(`${site.name}: a harsh message is flagged, and sending starts afresh`, async ({ page, worker }) => {
    await sitesReady(worker)
    await setSettings(worker, { pauseRedSends: false })
    await page.goto(site.url)
    const box   = page.locator("#box")
    const popup = page.locator("#sg-popup-host .popup")
    const badge = page.locator(".sg-badge-host .badge.visible")

    await box.click()
    await expect(badge).toHaveCount(1)
    await box.pressSequentially(HARSH)
    await expect(badge).toHaveAttribute("data-state", "flagged")
    await expect(popup).toBeVisible()
    await expect(page.locator(".sg-highlight").first()).toBeVisible()

    if (site.sends === "enter") await box.press("Enter")
    else {
      // The card can sit over the site's Send button: close it first, as a person would
      await page.keyboard.press("Escape")
      await page.locator("#sendbtn").click()
    }
    await expect(page.locator("#log .sent")).toHaveText([HARSH])
    await expect(page.locator(".sg-highlight")).toHaveCount(0)
    // The badge hides once the box isn't in use, so look at it whether shown or not
    await expect(page.locator(".sg-badge-host .badge").first()).not.toHaveAttribute("data-state", "flagged")
  })
}

test("a red message is held on a site's own form until Send anyway", async ({ page, worker }) => {
  await sitesReady(worker)
  await page.goto("https://www.linkedin.com/")
  const box = page.locator("#box")
  await box.click()
  await box.pressSequentially(HARSH)
  await expect(page.locator("#sg-popup-host .popup")).toBeVisible()
  await page.keyboard.press("Escape")
  await page.locator("#sendbtn").click()
  await expect(page.locator("#sg-popup-host #send-anyway")).toBeVisible()
  await expect(page.locator("#log .sent")).toHaveCount(0)
  await page.locator("#sg-popup-host #send-anyway").click()
  await expect(page.locator("#log .sent")).toHaveText([HARSH])
})
