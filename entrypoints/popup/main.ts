// popup — runs inside the extension action popup
import { browser } from "#imports"
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

// ── Chat context ────────────────────────────────────────────────────────────

function renderChatContext(s: Settings) {
  $<HTMLInputElement>("chatContext").checked = s.chatContext
  $("chatContextSub").textContent = s.chatContext
    ? "On — checks read the last 6 messages in the chat. They stay on this computer and are never saved."
    : "Off — only your own message is checked"
}

$<HTMLInputElement>("chatContext").addEventListener("change", e => updateSettings({
  chatContext: (e.target as HTMLInputElement).checked,
  chatContextOffered: true,
}))

// ── Incoming messages ───────────────────────────────────────────────────────

function renderIncoming(s: Settings) {
  $<HTMLInputElement>("incomingAnalysis").checked = s.incomingAnalysis
  $("incomingSub").textContent = s.incomingAnalysis
    ? "On — a dot shows how a new message probably reads, when it isn't obvious"
    : "Off — received messages aren't read"
}

$<HTMLInputElement>("incomingAnalysis").addEventListener("change", e =>
  updateSettings({ incomingAnalysis: (e.target as HTMLInputElement).checked }))

function render(s: Settings) {
  renderPower(s)
  renderStyle(s)
  renderChatContext(s)
  renderIncoming(s)
}

$("openSites").addEventListener("click", () => browser.runtime.openOptionsPage())

// The child can always see when sharing with a parent is on (Plan 5.2)
sendMessage({ type: "SHARING_STATUS" }).then(s => { $("sharedLine").hidden = !s?.paired })

getSettings().then(render)
subscribeSettings(render)

// ── AI status ───────────────────────────────────────────────────────────────

const dot  = $("statusDot")
const text = $("statusText")

$("setupBtn").addEventListener("click", () => {
  browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") })
  window.close()
})

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
      text.textContent = "The AI model isn't installed yet"
      $("setupBtn").hidden = false
      break
    default:
      dot.classList.add("red")
      text.textContent = "The AI isn't running"
      $("setupBtn").hidden = false
  }
}

showStatus()
