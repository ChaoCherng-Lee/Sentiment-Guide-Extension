// Setup page — opens on install, and whenever the AI isn't ready (from the
// badge or the toolbar popup). First: where checks happen (Plan 8.4).
//   - Recommended: Chrome's built-in AI if this computer can run it (with a
//     one-click download of Chrome's model), otherwise the private cloud check.
//   - Fully private: Ollama, installed and set up without a terminal.
// Then the user's choices, and a "try it" box to see a check before leaving.
import { browser } from "#imports"
import { BackendError, type BackendId } from "../../src/analysis/backend"
import { downloadBuiltinModel } from "../../src/analysis/builtin"
import { type PullUpdate, pullModel, pullProgress, SETUP_MODEL } from "../../src/analysis/ollama"
import { type AIStatus, sendMessage } from "../../src/messaging"
import { ALL_WEBSITES } from "../../src/platforms/sites"
import { getSettings, updateSettings } from "../../src/settings/store"

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const POLL_MS = 2000
let pulling = false
let downloadingBuiltin = false
/** Why the last download stopped; shown until the next try */
let pullError = ""
let builtinError = ""

type Choice = "recommended" | "ollama"
let choice: Choice = "recommended"
/** Recommended has switched to its pick since it was chosen */
let applied = false
/** Recommended's answer won't change by waiting (it's ready, or nothing is available) */
let settled = false

const PRIVACY: Record<BackendId | "none", string> = {
  builtin: "The AI runs on this computer, inside Chrome. Your messages never leave it, and no account is needed.",
  cloud:   "Each message you write is checked by our private cloud check and forgotten: never stored, never used to train AI. The chat around it stays on this computer, and no account is needed.",
  ollama:  "The AI runs on this computer. Your messages are never sent to any server, and no account is needed.",
  none:    "Your messages are checked and forgotten. No account is needed.",
}

function setStep(id: string, state: "done" | "waiting" | "active") {
  const step = $(id)
  const num  = step.querySelector<HTMLElement>(".num")!
  num.dataset.n ??= num.textContent ?? ""
  num.textContent = state === "done" ? "✓" : num.dataset.n
  step.classList.toggle("done", state === "done")
  step.classList.toggle("waiting", state === "waiting")
}

const usable = (s: AIStatus | undefined) => s?.state === "ready" || s?.state === "idle"

/** Switch to `backend` if it isn't the one in use already. */
async function use(backend: BackendId) {
  if ((await getSettings()).backend !== backend) await updateSettings({ backend })
}

// ── Recommended: Chrome's built-in AI, else the cloud check ─────────────────

interface Recommendation {
  backend: BackendId | null
  ready: boolean
  line: string
  /** Chrome can run its AI but needs the model first */
  download?: boolean
}

async function recommend(): Promise<Recommendation> {
  const builtin = await sendMessage({ type: "AI_STATUS", backend: "builtin" })
  if (builtin?.state === "ready") {
    return { backend: "builtin", ready: true, line: "✓ This computer can run Chrome's built-in AI, so your messages are checked right here." }
  }
  if (builtin?.state === "downloadable" || builtin?.state === "downloading") {
    return {
      backend: "builtin", ready: false, download: builtin.state === "downloadable",
      line: builtin.state === "downloading"
        ? "Chrome is downloading its AI model…"
        : "This computer can run Chrome's built-in AI. Chrome needs to download its model once.",
    }
  }
  const cloud = await sendMessage({ type: "AI_STATUS", backend: "cloud" })
  if (cloud?.state === "ready") {
    return { backend: "cloud", ready: true, line: "✓ This computer can't run Chrome's built-in AI, so messages are checked by our private cloud check: checked and forgotten, never stored." }
  }
  if (cloud?.state === "offline") {
    return { backend: "cloud", ready: false, line: "This computer can't run Chrome's built-in AI, and the cloud check can't be reached — are you online? This page tries again by itself." }
  }
  return { backend: null, ready: false, line: "This version can't use Chrome's built-in AI or the cloud check here. Choose Fully private below." }
}

async function refreshRecommended() {
  if (downloadingBuiltin) return
  const r = await recommend()
  if (choice !== "recommended" || downloadingBuiltin) return
  settled = r.ready || r.backend === null
  // Switch only to something that works (Chrome's AI after its download), and
  // only once per choice: a change made in Settings meanwhile isn't undone
  if (r.backend && r.ready && !applied) { applied = true; await use(r.backend) }
  const status = $("recommendedStatus")
  status.textContent = builtinError && r.download ? builtinError : r.line
  status.classList.toggle("warn", (!!builtinError && !!r.download) || (!r.ready && !r.download && r.backend !== "builtin"))
  $("builtinDownload").hidden = !r.download
  setStep("stepWhere", r.ready ? "done" : "active")
  $("privacyText").textContent = PRIVACY[r.backend ?? "none"]
  $("readyLine").hidden = !r.ready
}

async function downloadBuiltin() {
  downloadingBuiltin = true
  builtinError = ""
  const btn = $<HTMLButtonElement>("builtinBtn")
  btn.disabled = true
  $("builtinBar").hidden = false
  $("recommendedStatus").textContent = "Chrome is downloading its AI model…"
  try {
    // Chrome only starts the download from a click, which this is
    await downloadBuiltinModel(fraction => {
      $("builtinFill").style.width = `${Math.round(fraction * 100)}%`
      $("recommendedStatus").textContent = `Chrome is downloading its AI model… ${Math.round(fraction * 100)}%`
    })
    await use("builtin")
    applied = true
  } catch (err) {
    builtinError = `The download didn't finish (${(err as Error).message}). Press the button to try again.`
    btn.textContent = "Try the download again"
  } finally {
    btn.disabled = false
    $("builtinBar").hidden = true
    downloadingBuiltin = false
    refresh()
  }
}

// ── Fully private: Ollama ─────────────────────────────────────────────────────

async function refreshOllama() {
  const status = await sendMessage({ type: "AI_STATUS", backend: "ollama" })
  if (choice !== "ollama") return
  const state  = status?.state ?? "offline"

  const ollamaUp = state !== "offline"
  setStep("stepOllama", ollamaUp ? "done" : "active")
  $("ollamaStatus").innerHTML = ollamaUp
    ? "✓ Ollama is running."
    : `<span class="waiting-dot"></span>Waiting for Ollama…`
  $("ollamaHelp").hidden = ollamaUp

  const modelReady = usable(status)
  setStep("stepModel", modelReady ? "done" : ollamaUp ? "active" : "waiting")
  setStep("stepWhere", modelReady ? "done" : "active")
  if (!pulling) {
    const showError = !!pullError && !modelReady
    $("modelStatus").textContent = modelReady
      ? `✓ ${status?.model} is installed.`
      : showError ? pullError
      : ollamaUp ? "Sentiment Guide needs one AI model, Gemma 3 (made by Google)." : "After Ollama is running."
    $("modelStatus").classList.toggle("warn", showError)
    $("modelHelp").hidden = modelReady || !ollamaUp
  }
  $("privacyText").textContent = PRIVACY.ollama
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
    const offline = err instanceof BackendError && err.kind === "offline"
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

// ── Choosing ─────────────────────────────────────────────────────────────────

async function choose(c: Choice) {
  choice = c
  applied = settled = false
  $<HTMLInputElement>(c === "ollama" ? "choiceOllama" : "choiceRecommended").checked = true
  $("recommendedBox").hidden = c !== "recommended"
  $("ollamaSteps").hidden    = c !== "ollama"
  // Steps after the choice are numbered on from it
  const choicesNum = $("choicesNum")
  choicesNum.dataset.n = c === "ollama" ? "4" : "2"
  if (!$("stepChoices").classList.contains("done")) choicesNum.textContent = choicesNum.dataset.n
  if (c === "ollama") await use("ollama")
  refresh()
}

function refresh() {
  if (choice === "ollama") { if (!pulling) refreshOllama() }
  else refreshRecommended()
}

for (const id of ["choiceRecommended", "choiceOllama"]) {
  $<HTMLInputElement>(id).addEventListener("change", e => {
    if ((e.target as HTMLInputElement).checked) choose((e.target as HTMLInputElement).value as Choice)
  })
}

// ── Try it ───────────────────────────────────────────────────────────────────

async function tryIt() {
  const text = $<HTMLTextAreaElement>("tryText").value.trim()
  const out  = $("tryResult")
  if (!text) return
  const btn = $<HTMLButtonElement>("tryBtn")
  btn.disabled = true
  out.hidden = false
  out.className = "try-result"
  out.textContent = "Checking…"
  try {
    const res = await sendMessage({ type: "CHECK_TONE", text, context: null, recent: [], sessionId: "setup-try" })
    if (!res?.ok) {
      out.className = "try-result yellow"
      out.textContent = "The AI isn't ready yet — finish step 1 first, then try again."
      return
    }
    const { verdict } = res
    if (verdict.tone === "green") {
      out.className = "try-result green"
      out.textContent = "✓ Sounds fine — you'd see a calm green tick on the message box."
      return
    }
    out.className = "try-result " + verdict.tone
    out.textContent = verdict.tone === "red" ? "This could hurt. Thinking of a kinder way to say it…" : "This might come across badly. Thinking of a kinder way to say it…"
    const advice = await sendMessage({
      type: "GET_ADVICE", text, verdict, context: null, recent: [], style: (await getSettings()).suggestionStyle,
      eventId: crypto.randomUUID(), platform: "web", sessionId: "setup-try", trial: true,
    })
    if (advice?.ok) {
      out.textContent = advice.advice.explanation
      if (advice.advice.suggestion) {
        const rewrite = document.createElement("span")
        rewrite.className = "rewrite"
        rewrite.textContent = `Try: “${advice.advice.suggestion}”`
        out.append(rewrite)
      }
    }
  } finally {
    btn.disabled = false
  }
}

$("tryBtn").addEventListener("click", tryIt)
$("pullBtn").addEventListener("click", download)
$("builtinBtn").addEventListener("click", downloadBuiltin)

// ── Start ────────────────────────────────────────────────────────────────────

getSettings().then(async s => {
  $<HTMLInputElement>("incomingAnalysis").checked = s.incomingAnalysis
  // Coming back to setup: start from what's in use. A new install starts on Recommended.
  const { onboardingDone } = await browser.storage.local.get("onboardingDone")
  choose(onboardingDone && s.backend === "ollama" ? "ollama" : "recommended")
})

$("btnStart").addEventListener("click", async () => {
  // First, while the click still counts as the user's: Chrome only asks then
  if ($<HTMLInputElement>("allWebsites").checked) {
    await browser.permissions.request({ origins: ALL_WEBSITES.origins }).catch(() => false)
  }
  await updateSettings({ incomingAnalysis: $<HTMLInputElement>("incomingAnalysis").checked })
  await browser.storage.local.set({ onboardingDone: true })
  window.close()
})

// Waits for Ollama to start, a model to download or the network to come back
setInterval(() => {
  if (pulling || downloadingBuiltin || (choice === "recommended" && settled)) return
  refresh()
}, POLL_MS)
