// Setup page — opens on install, and whenever the AI isn't ready (from the
// badge or the toolbar popup). Walks through installing Ollama and the model
// without a terminal, then the user's choices.
import { browser } from "#imports"
import { OllamaError, type PullUpdate, pullModel, pullProgress, SETUP_MODEL } from "../../src/analysis/ollama"
import { sendMessage } from "../../src/messaging"
import { ALL_WEBSITES } from "../../src/platforms/sites"
import { getSettings, updateSettings } from "../../src/settings/store"

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const POLL_MS = 2000
let pulling = false
/** Why the last download stopped; shown until the next try */
let pullError = ""

function setStep(id: string, state: "done" | "waiting" | "active") {
  const step = $(id)
  const num  = step.querySelector<HTMLElement>(".num")!
  num.dataset.n ??= num.textContent ?? ""
  num.textContent = state === "done" ? "✓" : num.dataset.n
  step.classList.toggle("done", state === "done")
  step.classList.toggle("waiting", state === "waiting")
}

/** Check where setup stands, and show the next thing to do. Runs every couple of seconds. */
async function refresh() {
  const status = await sendMessage({ type: "AI_STATUS" })
  const state  = status?.state ?? "offline"

  const ollamaUp = state !== "offline"
  setStep("stepOllama", ollamaUp ? "done" : "active")
  $("ollamaStatus").innerHTML = ollamaUp
    ? "✓ Ollama is running."
    : `<span class="waiting-dot"></span>Waiting for Ollama…`
  $("ollamaHelp").hidden = ollamaUp

  const modelReady = state === "ready" || state === "idle"
  setStep("stepModel", modelReady ? "done" : ollamaUp ? "active" : "waiting")
  if (!pulling) {
    const showError = !!pullError && !modelReady
    $("modelStatus").textContent = modelReady
      ? `✓ ${status?.model} is installed.`
      : showError ? pullError
      : ollamaUp ? "Sentiment Guide needs one AI model, Gemma 3 (made by Google)." : "After Ollama is running."
    $("modelStatus").classList.toggle("warn", showError)
    $("modelHelp").hidden = modelReady || !ollamaUp
  }
  $("readyLine").hidden = !modelReady
}

async function download() {
  pulling = true
  pullError = ""
  const btn = $<HTMLButtonElement>("pullBtn")
  btn.disabled = true
  $("pullBar").hidden = false
  // Only each layer's latest report matters
  const latest = new Map<string, PullUpdate>()
  try {
    await pullModel(SETUP_MODEL, u => {
      if (u.digest) latest.set(u.digest, u)
      const { completed, total } = pullProgress(latest.values())
      if (total) {
        $("pullFill").style.width = `${Math.round((completed / total) * 100)}%`
        $("modelStatus").textContent = `Downloading… ${gb(completed)} of ${gb(total)} GB`
      } else {
        $("modelStatus").textContent = u.status === "success" ? "Finishing…" : "Getting ready…"
      }
    })
    $("pullFill").style.width = "100%"
  } catch (err) {
    const offline = err instanceof OllamaError && err.kind === "offline"
    pullError = offline
      ? "The download stopped — is Ollama still open? Press the button to carry on where it left off."
      : `The download didn't finish (${(err as Error).message}). Press the button to carry on.`
    btn.textContent = "Carry on downloading"
    btn.disabled = false
  } finally {
    pulling = false
    $("pullBar").hidden = true
    refresh()
  }
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1)

$("pullBtn").addEventListener("click", download)

getSettings().then(s => { $<HTMLInputElement>("incomingAnalysis").checked = s.incomingAnalysis })

$("btnStart").addEventListener("click", async () => {
  // First, while the click still counts as the user's: Chrome only asks then
  if ($<HTMLInputElement>("allWebsites").checked) {
    await browser.permissions.request({ origins: ALL_WEBSITES.origins }).catch(() => false)
  }
  await updateSettings({ incomingAnalysis: $<HTMLInputElement>("incomingAnalysis").checked })
  await browser.storage.local.set({ onboardingDone: true })
  window.close()
})

refresh()
setInterval(() => { if (!pulling) refresh() }, POLL_MS)
