// Settings — tabs (General, Sites, Parent sharing in the family edition, Privacy, The AI), picked by
// the address's #hash so other pages can link straight to one.
//
// Sites: each optional site is an optional host permission; the background
// worker registers its content script while it's granted. "All websites"
// covers Instagram and Gmail too, so those two can also be switched off by
// name (settings.disabledSites) while all websites stays on.
import { browser } from "#imports"
import { FAMILY } from "../../src/edition"
import { BACKEND_IDS, type BackendId } from "../../src/analysis/backend"
import type { Sensitivity, SuggestionStyle } from "../../src/analysis/types"
import { type AIStatus, sendMessage } from "../../src/messaging"
import { OPTIONAL_SITES, type OptionalSite } from "../../src/platforms/sites"
import {
  getSettings, isSiteDisabled, setSiteDisabled, type Settings, subscribeSettings, updateSettings,
} from "../../src/settings/store"

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

let settings: Settings | null = null

// ── Tabs ────────────────────────────────────────────────────────────────────

// Parent sharing is only in the family edition (Plan 11.1)
const TABS = ["general", "sites", ...(FAMILY ? ["sharing"] : []), "privacy", "ai"]
if (!FAMILY) { $("tab-sharing").remove(); $("sharing").remove() }

function showTab() {
  const current = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "general"
  for (const id of TABS) {
    $(id).hidden = id !== current
    $("tab-" + id).setAttribute("aria-selected", String(id === current))
  }
  if (current === "ai") showStatus()
  if (current === "privacy") showPrivacy()
}

window.addEventListener("hashchange", showTab)
showTab()

// ── General ─────────────────────────────────────────────────────────────────

const STYLE_HINTS: Record<SuggestionStyle, string> = {
  casual: "Like texting a friend — slang and emoji are fine",
  formal: "Polite full sentences — for teachers or email",
  direct: "Short and clear — keeps your point, drops the harshness",
}

const SENSITIVITY_HINTS: Record<Sensitivity, string> = {
  gentle:   "Only messages that would clearly hurt. Blunt is fine",
  balanced: "Unkind, rude or sarcastic messages — the usual choice",
  strict:   "Also messages that might come across as cold or curt",
}

function renderGeneral(s: Settings) {
  document.querySelectorAll<HTMLElement>("#sensitivity [data-sensitivity]").forEach(btn => {
    btn.setAttribute("aria-checked", String(btn.dataset.sensitivity === s.sensitivity))
  })
  $("sensitivityHint").textContent = SENSITIVITY_HINTS[s.sensitivity]

  document.querySelectorAll<HTMLElement>("#style [data-style]").forEach(btn => {
    btn.setAttribute("aria-checked", String(btn.dataset.style === s.suggestionStyle))
  })
  $("styleHint").textContent = STYLE_HINTS[s.suggestionStyle]

  $<HTMLInputElement>("chatContext").checked = s.chatContext
  $("chatContextSub").textContent = s.chatContext
    ? "On — checks read the last 6 messages in the chat. They stay on this computer and are never saved."
    : "Off — only your own message is checked"

  $<HTMLInputElement>("pauseRedSends").checked = s.pauseRedSends
  $("pauseRedSub").textContent = s.pauseRedSends
    ? "On — pressing Send on a red message shows the card first. Send anyway is one click, or Ctrl+Enter"
    : "Off — messages always send straight away"

  $<HTMLInputElement>("incomingAnalysis").checked = s.incomingAnalysis
  $("incomingSub").textContent = s.incomingAnalysis
    ? "On — a dot shows how a new message probably reads, when it isn't obvious"
    : "Off — received messages aren't read"
}

document.querySelectorAll<HTMLElement>("#style [data-style]").forEach(btn => {
  btn.addEventListener("click", () => updateSettings({ suggestionStyle: btn.dataset.style as SuggestionStyle }))
})
document.querySelectorAll<HTMLElement>("#sensitivity [data-sensitivity]").forEach(btn => {
  btn.addEventListener("click", () => updateSettings({ sensitivity: btn.dataset.sensitivity as Sensitivity }))
})
$<HTMLInputElement>("chatContext").addEventListener("change", e => updateSettings({
  chatContext: (e.target as HTMLInputElement).checked,
  chatContextOffered: true,
}))
$<HTMLInputElement>("pauseRedSends").addEventListener("change", e =>
  updateSettings({ pauseRedSends: (e.target as HTMLInputElement).checked }))
$<HTMLInputElement>("incomingAnalysis").addEventListener("change", e =>
  updateSettings({ incomingAnalysis: (e.target as HTMLInputElement).checked }))

// ── Sites ───────────────────────────────────────────────────────────────────

const status = $("status")

/** The hostname a single-site pattern is for ("https://mail.google.com/*" → "mail.google.com"); null for wildcards. */
function hostOf(site: OptionalSite): string | null {
  const host = site.origins[0].match(/^\w+:\/\/([^/*]+)\//)?.[1]
  return host ?? null
}

async function isOn(site: OptionalSite): Promise<boolean> {
  const granted = await browser.permissions.contains({ origins: site.origins })
  const host = hostOf(site)
  return granted && !(host && settings && isSiteDisabled(settings, host))
}

function siteRow(site: OptionalSite): HTMLElement {
  const el = document.createElement("div")
  el.className = "site"
  el.innerHTML = `
    <div><h2></h2><p></p></div>
    <label class="switch"><input type="checkbox" /><span class="slider"></span></label>`
  el.querySelector("h2")!.textContent = site.name
  el.querySelector("p")!.textContent  = site.description
  const input = el.querySelector("input")!
  input.id = "site-" + site.id
  input.setAttribute("aria-label", `Check what you write on ${site.name}`)

  input.addEventListener("change", async () => {
    status.textContent = ""
    const host = hostOf(site)
    try {
      if (input.checked) {
        // Must run straight from the click: Chrome only shows the prompt for a user gesture
        const ok = await browser.permissions.request({ origins: site.origins })
        if (!ok) status.textContent = `${site.name} wasn't allowed, so it stays off.`
        else if (host) await setSiteDisabled(host, false)
      } else {
        await browser.permissions.remove({ origins: site.origins })
        // Still allowed through "All websites": switch it off by name instead
        if (host && await browser.permissions.contains({ origins: site.origins })) await setSiteDisabled(host, true)
      }
    } catch (err) {
      status.textContent = (err as Error).message
    }
    renderSites()
  })
  return el
}

$("siteList").replaceChildren(...OPTIONAL_SITES.map(siteRow))

async function renderSites() {
  for (const site of OPTIONAL_SITES) {
    $<HTMLInputElement>("site-" + site.id).checked = await isOn(site)
  }
  const off = settings?.disabledSites ?? []
  $("offEmpty").hidden = off.length > 0
  $("offList").replaceChildren(...off.map(host => {
    const li = document.createElement("li")
    const name = document.createElement("span")
    name.textContent = host
    const btn = document.createElement("button")
    btn.className = "btn small"
    btn.textContent = "Turn back on"
    btn.setAttribute("aria-label", `Turn checking back on for ${host}`)
    btn.addEventListener("click", () => setSiteDisabled(host, false))
    li.append(name, btn)
    return li
  }))
}

browser.permissions.onAdded.addListener(() => renderSites())
browser.permissions.onRemoved.addListener(() => renderSites())

// ── Share with a parent ─────────────────────────────────────────────────────

const PAIR_ERRORS = {
  invalid:        "That code didn't work. Codes last 15 minutes and work once — ask for a new one.",
  too_many:       "Too many tries. Wait an hour, then ask for a new code.",
  not_configured: "Sharing isn't set up in this version of the extension.",
  error:          "Couldn't reach the server. Check your internet connection and try again.",
}

async function renderSharing() {
  const s = await sendMessage({ type: "SHARING_STATUS" })
  $("sharingNotSetUp").hidden = !!s?.configured
  $("sharingSetUp").hidden    = !s?.configured
  $("sharingOff").hidden      = !!s?.paired
  $("sharingOn").hidden       = !s?.paired
}

// Pairing only unlocks once the child has read what's shared and agreed
$("consent").addEventListener("change", e => {
  const agreed = (e.target as HTMLInputElement).checked
  $<HTMLInputElement>("pairCode").disabled = !agreed
  $<HTMLButtonElement>("pairBtn").disabled = !agreed
})

$("unlinkBtn").addEventListener("click", async () => {
  if (!confirm("Stop sharing with your parent and delete everything that was shared?")) return
  const out = $("unlinkStatus")
  out.textContent = "Deleting…"
  const ok = await sendMessage({ type: "UNLINK_AND_DELETE" })
  out.textContent = ok ? "" : "Couldn't reach the server, so nothing was deleted yet. Try again when you're online."
  renderSharing()
})

$("pairBtn").addEventListener("click", async () => {
  const out = $("pairStatus")
  out.textContent = "Linking…"
  const result = await sendMessage({ type: "PAIR", code: $<HTMLInputElement>("pairCode").value.trim() })
  out.textContent = !result || result === "ok" ? "" : PAIR_ERRORS[result]
  renderSharing()
})

if (FAMILY) renderSharing()

// ── The AI ──────────────────────────────────────────────────────────────────

const BACKEND_NAMES: Record<BackendId, string> = {
  builtin: "Chrome's built-in AI",
  cloud:   "the private cloud check",
  ollama:  "Ollama",
}

/** One line about a backend's state, in words. */
function describeStatus(s: AIStatus | undefined): string {
  if (!s) return "Can't tell right now"
  switch (s.state) {
    case "ready":        return s.model ? `Ready · ${s.model}` : "Ready"
    case "idle":         return `Ready · ${s.model} loads on the first check`
    case "no-model":     return "Ollama is running, but the AI model isn't installed yet"
    case "downloadable": return "Chrome needs to download its AI model once — open setup"
    case "downloading":  return "Chrome is downloading its AI model…"
    case "unsupported":  return s.detail ?? "Not available here"
    case "offline":      return s.backend === "ollama" ? "Ollama isn't running" : (s.detail ?? "Can't be reached")
  }
}

async function showStatus() {
  const s   = await sendMessage({ type: "AI_STATUS" })
  const ok  = s?.state === "ready" || s?.state === "idle"
  $("statusDot").className = "status-dot " + (ok ? "green" : "red")
  $("statusText").textContent = s
    ? `${ok ? "Checking with" : "Chosen:"} ${BACKEND_NAMES[s.backend]} — ${describeStatus(s)}`
    : "Can't tell right now"
  $("setupBtn").textContent = ok ? "Open setup" : "Set it up"

  // Every backend, so they can be compared and switched (never switched without asking)
  for (const id of BACKEND_IDS) {
    const other = id === s?.backend ? s : await sendMessage({ type: "AI_STATUS", backend: id })
    $(`status-${id}`).textContent = describeStatus(other)
    const unavailable = other?.state === "unsupported"
    $(`row-${id}`).classList.toggle("unavailable", unavailable)
    const radio = $<HTMLInputElement>(`backend-${id}`)
    radio.disabled = unavailable && id !== s?.backend
    radio.checked  = id === s?.backend
  }
}

for (const id of BACKEND_IDS) {
  $<HTMLInputElement>(`backend-${id}`).addEventListener("change", async e => {
    if (!(e.target as HTMLInputElement).checked) return
    await updateSettings({ backend: id })
    showStatus()
  })
}

$("setupBtn").addEventListener("click", () => sendMessage({ type: "OPEN_PAGE", page: "setup" }))

// ── Privacy ─────────────────────────────────────────────────────────────────

// A function, not a constant: showTab() can run before this part of the file
function whereText(backend: BackendId): string {
  return ({
  builtin: "Nothing you write. Checks run on this computer, with Chrome's built-in AI.",
  ollama:  "Nothing you write. Checks run on this computer, with Ollama.",
  cloud:   "Each message you write is sent to the private cloud check, checked, and forgotten: not stored, not used to train AI. The chat around it, your answers about the chat and what \"It's fine\" taught it stay here.",
  } satisfies Record<BackendId, string>)[backend]
}

async function showPrivacy() {
  const s = await getSettings()
  let text = whereText(s.backend)
  if (FAMILY) {
    const sharing = await sendMessage({ type: "SHARING_STATUS" })
    if (sharing?.paired) text += " Counts of flagged messages (no text) are shared with your parent."
  }
  $("privacyWhere").textContent = text
}

$("deleteEverything").addEventListener("click", async () => {
  if (!confirm("Delete everything Sentiment Guide keeps on this computer? This can't be undone.")) return
  const ok = await sendMessage({ type: "DELETE_EVERYTHING" })
  $("deleteDone").hidden = !ok
  if (!ok) alert("Couldn't delete everything — please try again.")
})

// ── Start ───────────────────────────────────────────────────────────────────

function render(s: Settings) {
  settings = s
  renderGeneral(s)
  renderSites()
}

getSettings().then(render)
subscribeSettings(render)
