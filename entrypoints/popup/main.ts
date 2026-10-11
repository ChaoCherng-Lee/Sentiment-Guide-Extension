// popup — runs inside the extension action popup
import type { SuggestionStyle } from "../../src/analysis/types"
import { sendMessage } from "../../src/messaging"
import {
  getSettings, isActive, pauseUntil, resume, setEnabled, type Settings, subscribeSettings, tomorrowMorning,
  updateSettings,
} from "../../src/settings/store"

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ── On / off / pause ────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000

function formatTime(ms: number) {
  const d    = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return d.toDateString() === new Date().toDateString() ? time : `tomorrow ${time}`
}

function renderPower(s: Settings) {
  const paused = s.enabled && !isActive(s)
  $<HTMLInputElement>("enabled").checked = s.enabled
  $("powerState").textContent = !s.enabled ? "Off" : paused ? "Paused" : "On"
  $("powerSub").textContent   = !s.enabled
    ? "Not checking any messages"
    : paused ? `Back on at ${formatTime(s.pausedUntil!)}` : "Checking your messages"
  $("pauseRow").hidden  = !s.enabled || paused
  $("resumeRow").hidden = !paused
}

$<HTMLInputElement>("enabled").addEventListener("change", e => setEnabled((e.target as HTMLInputElement).checked))
$("pause1h").addEventListener("click", () => pauseUntil(Date.now() + HOUR))
$("pauseTomorrow").addEventListener("click", () => pauseUntil(tomorrowMorning()))
$("resume").addEventListener("click", () => resume())

// ── Suggestion style ────────────────────────────────────────────────────────

const STYLE_HINTS: Record<SuggestionStyle, string> = {
  casual: "Like texting a friend — slang and emoji are fine",
  formal: "Polite full sentences — for teachers or email",
  direct: "Short and clear — keeps your point, drops the harshness",
}

function renderStyle(s: Settings) {
  document.querySelectorAll<HTMLElement>("#style [data-style]").forEach(btn => {
    btn.setAttribute("aria-checked", String(btn.dataset.style === s.suggestionStyle))
  })
  $("styleHint").textContent = STYLE_HINTS[s.suggestionStyle]
}

document.querySelectorAll<HTMLElement>("#style [data-style]").forEach(btn => {
  btn.addEventListener("click", () => updateSettings({ suggestionStyle: btn.dataset.style as SuggestionStyle }))
})

function render(s: Settings) {
  renderPower(s)
  renderStyle(s)
}

getSettings().then(render)
subscribeSettings(render)

// ── AI status ───────────────────────────────────────────────────────────────

const dot  = $("statusDot")
const text = $("statusText")
const cmd  = $("statusCmd")

function showCommand(command: string) {
  cmd.style.display = "block"
  cmd.textContent   = command
}

async function showStatus() {
  const status = await sendMessage({ type: "AI_STATUS" })
  switch (status?.state) {
    case "ready":
      dot.classList.add("green")
      text.textContent = "Ready · " + status.model
      break
    case "idle":
      dot.classList.add("green")
      text.textContent = "Ollama running · " + status.model + " (loads on first check)"
      break
    case "no-model":
      dot.classList.add("red")
      text.textContent = "No Gemma model found — run:"
      showCommand("ollama pull gemma3:4b")
      break
    default:
      dot.classList.add("red")
      text.textContent = "Ollama not detected — run:"
      showCommand("ollama serve")
  }
}

showStatus()
