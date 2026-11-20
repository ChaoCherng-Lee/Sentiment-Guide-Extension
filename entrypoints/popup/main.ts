// Toolbar popup — the quick things: on / off / pause, this site, whether the
// AI is ready, and how the week is going. Everything else is in Settings.
import { browser } from "#imports"
import { sendMessage } from "../../src/messaging"
import { WHATSAPP_ORIGIN } from "../../src/platforms/sites"
import {
  getSettings, isActive, isSiteDisabled, pauseUntil, resume, setEnabled, setSiteDisabled, type Settings,
  subscribeSettings, tomorrowMorning,
} from "../../src/settings/store"
import { getWeek, weekLine } from "../../src/settings/week"

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
    ? "Not checking anything"
    : paused ? `Back on at ${formatTime(s.pausedUntil!)}` : "Checking what you write"
  $("pauseRow").hidden  = !s.enabled || paused
  $("resumeRow").hidden = !paused
}

$<HTMLInputElement>("enabled").addEventListener("change", e => setEnabled((e.target as HTMLInputElement).checked))
$("pause1h").addEventListener("click", () => pauseUntil(Date.now() + HOUR))
$("pauseTomorrow").addEventListener("click", () => pauseUntil(tomorrowMorning()))
$("resume").addEventListener("click", () => resume())

// ── This site ───────────────────────────────────────────────────────────────

/** The open tab's site, if Sentiment Guide checks it (Chrome only shows us its address then). */
let site: string | null = null

async function findSite() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url || !/^https?:/.test(tab.url)) return
  const url = new URL(tab.url)
  const covered = tab.url.startsWith(WHATSAPP_ORIGIN.slice(0, -1))
    || await browser.permissions.contains({ origins: [`${url.origin}/*`] })
  if (!covered) return
  site = url.hostname
  $("siteName").textContent = site.replace(/^www\./, "")
  $("siteSection").hidden = false
  getSettings().then(renderSite)
}

function renderSite(s: Settings) {
  if (!site) return
  const on = !isSiteDisabled(s, site)
  $<HTMLInputElement>("siteEnabled").checked = on
  $("siteSub").textContent = on ? "Checking this site" : "Not checking this site"
}

$<HTMLInputElement>("siteEnabled").addEventListener("change", e => {
  if (site) setSiteDisabled(site, !(e.target as HTMLInputElement).checked)
})

// ── AI status ───────────────────────────────────────────────────────────────

async function showStatus() {
  const status = await sendMessage({ type: "AI_STATUS" })
  const ok = status?.state === "ready" || status?.state === "idle"
  $("statusDot").classList.add(ok ? "green" : "red")
  $("statusText").textContent = ok ? "The AI is ready"
    : status?.state === "no-model" ? "The AI model isn't installed yet"
    : status?.state === "downloadable" || status?.state === "downloading" ? "Chrome's AI model isn't downloaded yet"
    : status?.state === "unsupported" ? "This AI isn't available here"
    : status?.backend === "cloud" ? "Can't reach the cloud check"
    : "The AI isn't running"
  $("statusText").title = !ok || !status ? ""
    : status.backend === "builtin" ? "Chrome's built-in AI, on this computer"
    : status.backend === "cloud" ? "The private cloud check: messages are checked and forgotten"
    : `${status.model}, running on this computer`
  $("setupBtn").hidden = ok
}

$("setupBtn").addEventListener("click", () => {
  sendMessage({ type: "OPEN_PAGE", page: "setup" })
  window.close()
})

// ── Week, settings ──────────────────────────────────────────────────────────

getWeek().then(stats => { $("weekLine").textContent = weekLine(stats, new Date()) })

$("openSettings").addEventListener("click", () => {
  browser.runtime.openOptionsPage()
  window.close()
})

// The child can always see when sharing with a parent is on (Plan 5.2)
sendMessage({ type: "SHARING_STATUS" }).then(s => { $("sharedLine").hidden = !s?.paired })

function render(s: Settings) {
  renderPower(s)
  renderSite(s)
}

getSettings().then(render)
subscribeSettings(render)
findSite()
showStatus()
