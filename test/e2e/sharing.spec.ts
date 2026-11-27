import type { Worker } from "@playwright/test"
import { expect, HARSH, openWhatsApp, test } from "./fixtures"

const SUPABASE = "https://sg-e2e-test.supabase.co"

interface Seen { uploads: Record<string, unknown>[]; rpcs: string[] }

/**
 * A pretend Supabase project inside the background worker: answers its
 * requests and records what it sends. (Playwright's routing doesn't reliably
 * see every request a service worker makes.)
 */
async function fakeSupabase(worker: Worker): Promise<() => Promise<Seen>> {
  await worker.evaluate((base) => {
    const g = globalThis as unknown as { fetch: typeof fetch; __sb: Seen }
    const original = g.fetch
    g.__sb = { uploads: [], rpcs: [] }
    g.fetch = async (input, init) => {
      const url = String(input)
      if (!url.startsWith(base)) return original(input, init)
      const path = new URL(url).pathname
      if (path === "/auth/v1/signup") {
        return new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600, user: { id: "child" } }))
      }
      if (path.startsWith("/rest/v1/rpc/")) {
        const name = path.slice("/rest/v1/rpc/".length)
        g.__sb.rpcs.push(name)
        return new Response(JSON.stringify(name === "redeem_pairing_code" ? "ok" : null))
      }
      if (path === "/rest/v1/events") {
        g.__sb.uploads.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 201 })
      }
      return new Response(null, { status: 404 })
    }
  }, SUPABASE)
  return () => worker.evaluate(() => (globalThis as unknown as { __sb: Seen }).__sb)
}

test("sharing needs consent first, shows when it's on, uploads no text, and can be undone", async ({ context, worker, extensionId }) => {
  const seen = await fakeSupabase(worker)
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html#sharing`)

  // Consent comes before the code can be entered
  await expect(options.locator("#sharing")).toBeVisible()
  await expect(options.locator("#sharingOff")).toContainText("What they won't see")
  await expect(options.locator("#pairBtn")).toBeDisabled()
  await options.locator("#consent").check()
  await options.locator("#pairCode").fill("123456")
  await options.locator("#pairBtn").click()
  await expect(options.locator("#sharingOn")).toContainText("Shared with parent: on")
  expect((await seen()).rpcs).toEqual(["redeem_pairing_code"])

  const menu = await context.newPage()
  await menu.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(menu.locator("#sharedLine")).toBeVisible()

  // A flagged message uploads counts-only data
  const page = await context.newPage()
  await openWhatsApp(page)
  await page.locator("footer [contenteditable]").pressSequentially(HARSH)
  await expect.poll(async () => (await seen()).uploads.length, { timeout: 90_000 }).toBeGreaterThan(0)
  const { uploads } = await seen()
  const row = uploads[0]
  expect(Object.keys(row).sort()).toEqual(["category", "confidence", "created_at", "id", "platform", "suggestion_accepted", "tone"])
  expect(row.platform).toBe("whatsapp")
  expect(JSON.stringify(uploads)).not.toMatch(/stupid|shut up|Alex/i)

  // Unlink and delete
  options.on("dialog", d => d.accept())
  await options.locator("#unlinkBtn").click()
  await expect(options.locator("#sharingOff")).toBeVisible()
  expect((await seen()).rpcs).toContain("delete_my_data")
})
