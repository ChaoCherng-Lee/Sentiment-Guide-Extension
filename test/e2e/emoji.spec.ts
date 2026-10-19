import type { Page, Worker } from "@playwright/test"
import { expect, openWhatsApp, test } from "./fixtures"

const box = (page: Page) => page.locator("footer [contenteditable]")

/** Record the user message of every model request the background worker sends. */
async function captureModelInput(worker: Worker) {
  await worker.evaluate(() => {
    const g = globalThis as unknown as { fetch: typeof fetch; __sent: string[] }
    const original = g.fetch
    g.__sent = []
    g.fetch = (input, init) => {
      if (String(input).includes("/api/chat") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { messages: { role: string; content: string }[] }
        g.__sent.push(body.messages.find(m => m.role === "user")?.content ?? "")
      }
      return original(input, init)
    }
  })
  return () => worker.evaluate(() => (globalThis as unknown as { __sent: string[] }).__sent)
}

test("a single emoji is checked", async ({ page, worker }) => {
  const sent = await captureModelInput(worker)
  await openWhatsApp(page)
  await box(page).pressSequentially("🙄")
  await expect.poll(sent, { timeout: 30_000 }).toContainEqual(expect.stringContaining("🙄"))
})

test("emoji drawn as images reach the model and can be highlighted", async ({ page, worker }) => {
  const sent = await captureModelInput(worker)
  await openWhatsApp(page)

  // WhatsApp may render emoji as <img> with the character in data-plain-text
  await box(page).evaluate(el => {
    el.innerHTML = '<p><span>whatever you say </span><img alt="🙄" data-plain-text="🙄" width="16" height="16"><span> you clown </span><img alt="🤡" data-plain-text="🤡" width="16" height="16"></p>'
    el.dispatchEvent(new InputEvent("input", { bubbles: true }))
  })

  await expect.poll(sent, { timeout: 30_000 }).toContainEqual(expect.stringContaining("whatever you say 🙄 you clown 🤡"))
  await expect(page.locator("#sg-popup-host .popup")).toBeVisible()
  await expect(page.locator(".sg-highlight").first()).toBeVisible()
})
