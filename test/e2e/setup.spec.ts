import { expect, setNoModel, setOllamaDown, test } from "./fixtures"

test("setup gets Ollama and the model ready without a terminal", async ({ context, worker, extensionId }) => {
  await setOllamaDown(worker, true)
  await setNoModel(worker, true)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)

  // 1. Ollama isn't running: a download link, and the page waits for it
  await expect(page.locator("#ollamaStatus")).toContainText("Waiting for Ollama")
  await expect(page.getByRole("link", { name: "Download Ollama" })).toHaveAttribute("href", "https://ollama.com/download")
  await expect(page.locator("#modelHelp")).toBeHidden()

  // It notices Ollama starting by itself
  await setOllamaDown(worker, false)
  await expect(page.locator("#ollamaStatus")).toContainText("Ollama is running")

  // 2. The model downloads from a button, with progress
  const MB = 1_000_000
  const lines = [
    { status: "pulling manifest" },
    { status: "pulling a", digest: "a", total: 3300 * MB, completed: 1650 * MB },
    { status: "pulling a", digest: "a", total: 3300 * MB, completed: 3300 * MB },
    { status: "success" },
  ].map(l => JSON.stringify(l)).join("\n") + "\n"
  let asked = ""
  await context.route("http://127.0.0.1:11434/api/pull", async route => {
    asked = route.request().postData() ?? ""
    await setNoModel(worker, false)
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines })
  })
  await page.locator("#pullBtn").click()
  await expect(page.locator("#modelStatus")).toContainText("gemma3:4b is installed")
  expect(JSON.parse(asked)).toMatchObject({ model: "gemma3:4b", stream: true })
  await expect(page.locator("#readyLine")).toBeVisible()

  // 3. Choices are saved on Done
  await page.locator("#incomingAnalysis").check()
  const closed = page.waitForEvent("close")
  await page.locator("#btnStart").click()
  await closed
  const settings = await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    return (await chrome.storage.sync.get("settings")).settings as { incomingAnalysis: boolean }
  })
  expect(settings.incomingAnalysis).toBe(true)
})

test("a failed download can be carried on", async ({ context, worker, extensionId }) => {
  await setNoModel(worker, true)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)
  await context.route("http://127.0.0.1:11434/api/pull", route =>
    route.fulfill({ status: 200, body: JSON.stringify({ error: "connection reset" }) + "\n" }))
  await page.locator("#pullBtn").click()
  await expect(page.locator("#modelStatus")).toContainText("didn't finish")
  await expect(page.locator("#pullBtn")).toHaveText("Carry on downloading")
  await expect(page.locator("#pullBtn")).toBeEnabled()
})
