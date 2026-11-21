import type { Page } from "@playwright/test"
import { expect, sitesReady, test } from "./fixtures"

const comment = (page: Page) => page.locator("#comment-box")
const post    = (page: Page) => page.locator("#post-box")
const popup   = (page: Page) => page.locator("#sg-popup-host .popup")
const badges  = (page: Page) => page.locator(".sg-badge-host .badge.visible")

async function openWebsite(page: Page, worker: Parameters<typeof sitesReady>[0]) {
  await sitesReady(worker)
  await page.goto("https://example.org/")
}

test("a plain textarea on any website is checked, and an edit swaps just the words", async ({ page, worker, extensionId }) => {
  await openWebsite(page, worker)
  // Badges stay out of the way until a box is used
  await expect(badges(page)).toHaveCount(0)
  await comment(page).click()
  await expect(badges(page)).toHaveCount(1)

  await comment(page).pressSequentially("honestly this is so annoying sometimes")
  await expect(badges(page)).toHaveAttribute("data-tone", "red")
  await expect(popup(page)).toBeVisible()

  // The underline sits on the words, inside the box
  const mark = (await page.locator(".sg-highlight").first().boundingBox())!
  const box  = (await comment(page).boundingBox())!
  expect(mark.x).toBeGreaterThan(box.x)
  expect(mark.y).toBeGreaterThan(box.y)
  expect(mark.y + mark.height).toBeLessThan(box.y + box.height)

  // No chats here: no chat context, and "don't check" means the whole site
  await popup(page).locator("#more").click()
  await expect(popup(page).locator("#edit-context")).toBeHidden()
  await expect(popup(page).locator("#disable-chat")).toHaveText("Don't check this site")
  await popup(page).locator("#more").click()

  const row = popup(page).locator(".edit-row").first()
  await row.locator(".btn-apply").click()
  await expect(comment(page)).toHaveValue("honestly this is so a lot right now sometimes")
  await expect(badges(page)).toHaveAttribute("data-state", "fine")

  // The toolbar popup cheers it on
  const toolbar = await page.context().newPage()
  await toolbar.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(toolbar.locator("#weekLine")).toHaveText("This week: you took 1 suggestion 🎉")
  await toolbar.close()
  await page.bringToFront()
  await comment(page).focus()

  // Posting the form starts afresh (yellow: only red is held on send, see send-pause.spec)
  await comment(page).press("Control+a")
  await comment(page).pressSequentially("you're so lazy")
  await expect(badges(page)).toHaveAttribute("data-state", "flagged")
  await popup(page).locator("#close").click()
  await page.getByRole("button", { name: "Post" }).click()
  await expect(page.locator(".sg-highlight")).toHaveCount(0)
})

test("rich editors on other websites work too, and boxes that opt out are left alone", async ({ page, worker }) => {
  await openWebsite(page, worker)
  await post(page).click()
  await post(page).pressSequentially("shut up")
  await expect(popup(page)).toBeVisible()
  await popup(page).locator("#accept").click({ timeout: 30_000 })
  await expect(post(page)).toHaveText("hey I'm really annoyed rn, can we talk later?")

  await page.locator("#code-box").click()
  await page.locator("#code-box").pressSequentially("stupid = true")
  await page.waitForTimeout(1_500)
  await expect(badges(page)).toHaveCount(0)
  await expect(popup(page)).toBeHidden()
})

test("\"Don't check this site\" switches the whole site off, and back on", async ({ page, worker }) => {
  await openWebsite(page, worker)
  await comment(page).click()
  const badge = badges(page)
  await badge.click()
  await page.locator(".sg-badge-host .menu.open button[data-action='chat-off']").click()
  await expect(badge).toHaveAttribute("data-state", "chat-off")
  await expect(badge).toHaveAttribute("title", "Not checking this site")

  await comment(page).pressSequentially("you are so stupid")
  await page.waitForTimeout(1_500)
  await expect(popup(page)).toBeHidden()

  const disabled = await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    return ((await chrome.storage.sync.get("settings")).settings as { disabledSites: string[] }).disabledSites
  })
  expect(disabled).toEqual(["example.org"])

  // Back on from the same badge: the text already there is checked
  await badge.click()
  await page.locator(".sg-badge-host .menu.open button[data-action='chat-on']").click()
  await comment(page).press("End")
  await comment(page).pressSequentially("!")
  await expect(badge).toHaveAttribute("data-state", "flagged")
})
