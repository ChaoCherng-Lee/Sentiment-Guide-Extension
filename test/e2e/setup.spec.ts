import { expect, setNoModel, setOllamaDown, setSettings, storedSettings, test, useBuiltinAI, useCloud } from "./fixtures"

test("setup gets Ollama and the model ready without a terminal", async ({ context, worker, extensionId }) => {
  await setOllamaDown(worker, true)
  await setNoModel(worker, true)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)
  await page.locator("#choiceOllama").check()

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
  await page.locator("#choiceOllama").check()
  await context.route("http://127.0.0.1:11434/api/pull", route =>
    route.fulfill({ status: 200, body: JSON.stringify({ error: "connection reset" }) + "\n" }))
  await page.locator("#pullBtn").click()
  await expect(page.locator("#modelStatus")).toContainText("didn't finish")
  await expect(page.locator("#pullBtn")).toHaveText("Carry on downloading")
  await expect(page.locator("#pullBtn")).toBeEnabled()
})

test("Recommended uses Chrome's built-in AI when this computer can run it", async ({ context, worker, extensionId }) => {
  await useBuiltinAI(worker)
  await setSettings(worker, { backend: "ollama" })   // as on a new install
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)
  await expect(page.locator("#choiceRecommended")).toBeChecked()
  await expect(page.locator("#recommendedStatus")).toContainText("can run Chrome's built-in AI")
  await expect(page.locator("#ollamaSteps")).toBeHidden()
  await expect.poll(async () => (await storedSettings(worker)).backend).toBe("builtin")
  await expect(page.locator("#privacyText")).toContainText("never leave it")

  // A choice made in Settings while setup is still open isn't undone
  await setSettings(worker, { backend: "ollama" })
  await page.waitForTimeout(2500)
  expect((await storedSettings(worker)).backend).toBe("ollama")
})

test("Recommended offers Chrome's download when the model isn't there yet", async ({ context, worker, extensionId }) => {
  await useBuiltinAI(worker, "downloadable")
  await setSettings(worker, { backend: "ollama" })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)
  await expect(page.locator("#builtinBtn")).toBeVisible()
  await expect(page.locator("#recommendedStatus")).toContainText("download its model once")
  // Not switched until the model is there
  expect((await storedSettings(worker)).backend).toBe("ollama")
})

test("Recommended falls back to the cloud check, and the try-it box shows a real check", async ({ context, worker, extensionId }) => {
  await useCloud(worker)
  await setSettings(worker, { backend: "ollama" })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`)
  await expect(page.locator("#recommendedStatus")).toContainText("private cloud check", { timeout: 15_000 })
  await expect.poll(async () => (await storedSettings(worker)).backend).toBe("cloud")
  await expect(page.locator("#readyLine")).toBeVisible()

  await page.locator("#tryText").fill("you are so stupid")
  await page.locator("#tryBtn").click()
  await expect(page.locator("#tryResult")).toHaveClass(/red/)
  await expect(page.locator("#tryResult")).toContainText("Try: “I'm frustrated, can we talk later?”")
  // A try isn't a flag of the week
  const week = await worker.evaluate(async () =>
    (await (globalThis as unknown as { chrome: typeof import("wxt/browser").browser }).chrome.storage.local.get("weekStats")).weekStats)
  expect(week).toBeUndefined()
})
