import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { expect, HARSH, setSettings, sitesReady, test } from "./fixtures"

// Plan 11.4 (Spec NFR-6): no WCAG 2.1 A/AA problems axe can find, and
// everything reachable by keyboard.

async function axe(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()
  return violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(" ")).slice(0, 3).join(", ")}`)
}

for (const tab of ["general", "sites", "sharing", "privacy", "ai"]) {
  test(`Settings, ${tab} tab: no accessibility problems`, async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html#${tab}`)
    await expect(page.locator(`#${tab}`)).toBeVisible()
    expect(await axe(page)).toEqual([])
  })
}

// Contrast in both themes (Plan 11.4): the extension pages have a dark theme
for (const name of ["options.html#general", "options.html#ai", "popup.html", "onboarding.html"]) {
  test(`dark theme, ${name}: no accessibility problems`, async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto(`chrome-extension://${extensionId}/${name}`)
    await page.waitForLoadState("networkidle")
    expect(await axe(page)).toEqual([])
  })
}

for (const name of ["popup", "onboarding"]) {
  test(`the ${name} page: no accessibility problems`, async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/${name}.html`)
    await page.waitForLoadState("networkidle")
    expect(await axe(page)).toEqual([])
  })
}

test("the card and badge: no accessibility problems", async ({ page, worker }) => {
  await sitesReady(worker)
  await page.goto("https://example.org/")
  await page.locator("#comment-box").click()
  await page.keyboard.type(HARSH)
  await expect(page.locator("#sg-popup-host .popup")).toBeVisible()
  await expect(page.locator("#sg-popup-host #accept")).toBeVisible()
  expect(await axe(page, "#sg-popup-host")).toEqual([])
  expect(await axe(page, ".sg-badge-host")).toEqual([])
})

test("keyboard only: Alt+↓ into the card, pick a rewrite, Escape back to the box", async ({ page, worker }) => {
  await sitesReady(worker)
  await setSettings(worker, { pauseRedSends: false })
  await page.goto("https://example.org/")
  const box = page.locator("#comment-box")
  await box.focus()
  await page.keyboard.type(HARSH)
  const popup = page.locator("#sg-popup-host .popup")
  await expect(popup).toBeVisible()
  await expect(page.locator("#sg-popup-host .rewrite-choice").first()).toBeVisible()

  // Into the card and back out without using it
  await page.keyboard.press("Alt+ArrowDown")
  await expect(page.locator("#sg-popup-host .rewrite-choice").first()).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  await expect(box).toBeFocused()

  // The card reopens from the box; the arrow keys choose a rewrite, Tab goes on to use it
  await page.keyboard.press("Alt+ArrowDown")
  await expect(popup).toBeVisible()
  const choices = page.locator("#sg-popup-host .rewrite-choice")
  await page.keyboard.press("ArrowDown")
  await expect(choices.nth(1)).toBeFocused()
  await expect(choices.nth(1)).toHaveAttribute("aria-checked", "true")
  const chosen = await choices.nth(1).textContent()
  await page.keyboard.press("Tab")
  await expect(page.locator("#sg-popup-host #accept")).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(box).toHaveValue(chosen!)
  await expect(popup).toBeHidden()
})

test("a newly flagged message is announced politely", async ({ page, worker }) => {
  await sitesReady(worker)
  await page.goto("https://example.org/")
  await page.locator("#comment-box").click()
  await page.keyboard.type(HARSH)
  const live = page.locator(".sg-badge-host .live[aria-live=polite]").first()
  await expect(live).not.toBeEmpty()
})
