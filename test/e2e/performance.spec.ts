import { countModelCalls, expect, sitesReady, test } from "./fixtures"

// Plan 11.5: the Spec NFR-2 and NFR-3 budgets, enforced.

/** Spec NFR-2: input handler under 4 ms per character */
const MAX_SCRIPT_MS_PER_CHAR = 4
/** Spec NFR-3: memory added per tab ≤ 15 MB */
const MAX_HEAP_MB = 15
/** Spec NFR-3: never one request per keystroke (300 characters, typed steadily) */
const MAX_MODEL_CALLS = 10

// 300 characters of ordinary, then harsh, writing
const TEXT = ("hey, are we still on for tonight? i was thinking we could get food first and then go. "
  + "honestly you are so stupid sometimes, just shut up about it already, it is not a big deal at all. "
  + "anyway let me know what time works for you and i will book a table somewhere nice for the two of us later, ok?").padEnd(300, " ok").slice(0, 300)

test("typing 300 characters stays within the speed, memory and request budgets", async ({ page, worker }) => {
  test.setTimeout(120_000)
  expect(TEXT.length).toBe(300)
  await sitesReady(worker)
  const calls = await countModelCalls(worker)
  await page.goto("https://example.org/")
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const metric = async (name: string) =>
    (await cdp.send("Performance.getMetrics")).metrics.find(m => m.name === name)!.value

  // Pages only read: no AI calls at all (Spec NFR-2)
  await page.waitForTimeout(1500)
  expect(await calls()).toBe(0)

  const box = page.locator("#comment-box")
  await box.click()
  const scriptBefore = await metric("ScriptDuration")
  await box.pressSequentially(TEXT, { delay: 25 })
  const scriptMs = (await metric("ScriptDuration") - scriptBefore) * 1000
  const perChar = scriptMs / TEXT.length
  console.log(`script time per character: ${perChar.toFixed(2)} ms (budget ${MAX_SCRIPT_MS_PER_CHAR} ms)`)
  // All the page's script while typing (the extension's, the page's and the fixture's) counts against it
  expect(perChar).toBeLessThan(MAX_SCRIPT_MS_PER_CHAR)

  // Checks are debounced, not one per keystroke (Spec NFR-3)
  await expect(page.locator(".sg-badge-host .badge.visible")).toHaveAttribute("data-state", "flagged")
  const made = await calls()
  console.log(`model calls for 300 characters: ${made} (budget ${MAX_MODEL_CALLS})`)
  expect(made).toBeLessThanOrEqual(MAX_MODEL_CALLS)

  // Memory after use, card open (Spec NFR-3). The whole page's heap is counted,
  // so this is an upper bound on what the extension adds.
  await expect(page.locator("#sg-popup-host .popup")).toBeVisible()
  await cdp.send("HeapProfiler.collectGarbage")
  const heapMb = await metric("JSHeapUsedSize") / 1024 / 1024
  console.log(`page heap with the card open: ${heapMb.toFixed(1)} MB (budget ${MAX_HEAP_MB} MB)`)
  expect(heapMb).toBeLessThan(MAX_HEAP_MB)
})

test("an idle tab uses no measurable CPU", async ({ page, worker }) => {
  await sitesReady(worker)
  await page.goto("https://example.org/")
  await page.locator("#comment-box").click()
  await page.waitForTimeout(1000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const metric = async (name: string) =>
    (await cdp.send("Performance.getMetrics")).metrics.find(m => m.name === name)!.value
  const before = await metric("ScriptDuration")
  await page.waitForTimeout(5000)
  const idleMs = (await metric("ScriptDuration") - before) * 1000
  console.log(`script time over 5 s idle: ${idleMs.toFixed(1)} ms`)
  // Under 1% of one core (50 ms in 5 s)
  expect(idleMs).toBeLessThan(50)
})
