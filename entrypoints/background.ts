// =============================================================================
// background.ts
// Service worker. Runs tone analysis on the chosen backend (Ollama, Chrome's
// built-in AI or the cloud check) through a priority queue, reports AI
// status, and does optional Supabase logging.
// =============================================================================

import { browser, defineBackground } from "#imports"
import { BackendError, type ToneBackend } from "../src/analysis/backend"
import { backendFor } from "../src/analysis/backends"
import { OLLAMA_HOSTS } from "../src/analysis/ollama"
import { CancelledError, type Priority, RequestQueue } from "../src/analysis/queue"
import {
  flushUploads, isPaired, logAcceptance, logEvent, pairWithCode, supabaseConfigured, unlinkAndDelete,
} from "../src/backend/supabase"
import type { AIStatus, CheckFailure, Message, MessageOf, Responses } from "../src/messaging"
import { OPTIONAL_SITES } from "../src/platforms/sites"
import type { ScriptPublicPath } from "wxt/utils/inject-script"
import { getSettings, isActive, setEnabled, subscribeSettings, type Settings, updateSettings } from "../src/settings/store"
import { recordFine } from "../src/settings/feedback"
import { recordWeek } from "../src/settings/week"

const RESUME_ALARM          = "resume"
/** Retry uploads that failed (offline, server down) */
const UPLOAD_ALARM          = "upload-retry"
const CHECK_TIMEOUT_MS      = 30_000
/** Advice writes an explanation, a rewrite and phrase edits — much more text */
const ADVICE_TIMEOUT_MS     = 60_000
/** First check after the model was unloaded includes loading it — allow for that */
const COLD_CHECK_TIMEOUT_MS = 120_000

export default defineBackground(() => {
  console.log("Sentiment Guide: background worker started")

  const queue = new RequestQueue(1)
  let warming: Promise<void> | null = null

  allowOllamaRequests()
  initPowerControls()
  initSites()

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") })
    }
  })

  browser.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return

    switch (msg.type) {
      case "CHECK_TONE":
        checkTone(msg).then(sendResponse)
        return true
      case "GET_ADVICE":
        getAdvice(msg).then(sendResponse)
        return true
      case "READ_INCOMING":
        explainIncoming(msg).then(sendResponse)
        return true
      case "AI_STATUS":
        getStatus().then(sendResponse)
        return true
      case "WARM_UP":
        getSettings()
          .then(s => isActive(s) ? warm() : undefined)
          .then(() => sendResponse(), () => sendResponse())
        return true
      case "UPDATE_ACCEPTANCE":
        if (msg.accepted) recordWeek("accepted", msg.eventId)
        getSettings().then(s => logAcceptance(msg.eventId, msg.accepted, isActive(s)))
        return false
      case "FINE_FEEDBACK":
        recordWeek("fine", msg.eventId)
        recordFine(msg.tone, msg.reason)
        return false
      case "UNLINK_AND_DELETE":
        unlinkAndDelete().then(sendResponse)
        return true
      case "PAIR":
        pairWithCode(msg.code).then(sendResponse)
        return true
      case "SHARING_STATUS":
        isPaired().then(paired => sendResponse({ configured: supabaseConfigured(), paired }))
        return true
      case "OPEN_PAGE":
        if (msg.page === "settings") browser.runtime.openOptionsPage()
        else browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") })
        return false
    }
  })

  // ── On / off / pause ──────────────────────────────────────────────────────

  function initPowerControls() {
    subscribeSettings(applyPowerState)
    getSettings().then(s => {
      // A pause that ran out while the browser was closed
      if (s.pausedUntil !== null && s.pausedUntil <= Date.now()) updateSettings({ pausedUntil: null })
      else applyPowerState(s)
    })

    browser.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === RESUME_ALARM) updateSettings({ pausedUntil: null })
      if (alarm.name === UPLOAD_ALARM) getSettings().then(s => flushUploads(isActive(s)))
    })
    browser.alarms.create(UPLOAD_ALARM, { periodInMinutes: 15 })

    browser.commands.onCommand.addListener(async command => {
      if (command !== "toggle-enabled") return
      const s = await getSettings()
      setEnabled(!isActive(s))
    })
  }

  async function applyPowerState(s: Settings) {
    const active = isActive(s)
    if (!active) queue.cancelAll("paused")

    await browser.action.setBadgeText({ text: !s.enabled ? "OFF" : active ? "" : "II" })
    await browser.action.setBadgeBackgroundColor({ color: "#6b7280" })
    await browser.action.setTitle({
      title: !s.enabled ? "Sentiment Guide — off" : active ? "Sentiment Guide" : "Sentiment Guide — paused",
    })

    // Wake up to resume when the pause ends (alarms survive the worker sleeping)
    await browser.alarms.clear(RESUME_ALARM)
    if (s.enabled && s.pausedUntil !== null && s.pausedUntil > Date.now()) {
      browser.alarms.create(RESUME_ALARM, { when: s.pausedUntil })
    }
  }

  // ── Optional sites (all websites, Instagram, Gmail) ─────────────────────────────────────

  /**
   * A site's content script is registered only while its host permission is
   * granted (from the options page). Runs on every worker start, and whenever
   * permissions change.
   */
  function initSites() {
    syncSites()
    browser.permissions.onAdded.addListener(() => syncSites(true))
    browser.permissions.onRemoved.addListener(() => syncSites())
  }

  async function syncSites(injectIntoOpenTabs = false) {
    for (const site of OPTIONAL_SITES) {
      try {
        const granted    = await browser.permissions.contains({ origins: site.origins })
        const registered = (await browser.scripting.getRegisteredContentScripts({ ids: [site.id] })).length > 0
        if (granted && !registered) {
          await browser.scripting.registerContentScripts([{
            id: site.id, matches: site.origins, excludeMatches: site.excludeMatches,
            js: [site.script], runAt: "document_idle", persistAcrossSessions: true,
          }])
          // Tabs already open on the site start working without a reload
          if (injectIntoOpenTabs) {
            for (const tab of await browser.tabs.query({ url: site.origins })) {
              if (tab.id === undefined || site.excludeMatches?.some(p => matchesPattern(tab.url, p))) continue
              browser.scripting.executeScript({ target: { tabId: tab.id }, files: [("/" + site.script) as ScriptPublicPath] }).catch(() => {})
            }
          }
        } else if (!granted && registered) {
          await browser.scripting.unregisterContentScripts({ ids: [site.id] })
        }
      } catch (err) {
        console.log("Sentiment Guide bg: could not update", site.id, "—", (err as Error).message)
      }
    }
  }

  // ── Model ─────────────────────────────────────────────────────────────────

  /** The backend the user chose, read for every call so a change applies straight away. */
  async function currentBackend(): Promise<ToneBackend> {
    return backendFor((await getSettings()).backend)
  }

  async function getStatus(): Promise<AIStatus> {
    const backend = await currentBackend()
    return { backend: backend.id, ...(await backend.status()) }
  }

  function warm(): Promise<void> {
    warming ??= currentBackend().then(b => b.warm()).finally(() => { warming = null })
    return warming
  }

  // ── Tone check ────────────────────────────────────────────────────────────

  /**
   * Run one model call through the queue. Outgoing work from a compose box
   * shares one key, so a newer check from that box replaces an older one.
   * Incoming readings are low priority: outgoing checks always go first.
   */
  async function runModelCall<T>(
    key: string,
    call: (backend: ToneBackend, signal: AbortSignal, timeoutMs: number) => Promise<T>,
    timeoutMs = CHECK_TIMEOUT_MS,
    priority: Priority = "high",
  ): Promise<{ ok: true; value: T } | { ok: false; reason: CheckFailure }> {
    // Off or paused: never send anything to the model
    if (!isActive(await getSettings())) return { ok: false, reason: "paused" }
    try {
      const value = await queue.add(async (signal) => {
        const backend = await currentBackend()
        const cold    = await backend.isCold()
        return call(backend, signal, cold ? COLD_CHECK_TIMEOUT_MS : timeoutMs)
      }, { priority, key })
      return { ok: true, value }
    } catch (err) {
      const reason = failureReason(err)
      if (reason !== "cancelled") console.log("Sentiment Guide bg: model call failed —", reason, (err as Error).message)
      return { ok: false, reason }
    }
  }

  /**
   * Recent chat messages go to the model only when the user turned chat
   * context on and the model is on this computer. They are passed straight
   * to the prompt — never stored or logged.
   */
  async function allowedRecent(recent: MessageOf<"CHECK_TONE">["recent"] | undefined, backend: ToneBackend) {
    if (!recent?.length || !backend.local) return []
    return (await getSettings()).chatContext ? recent : []
  }

  async function checkTone(msg: MessageOf<"CHECK_TONE">): Promise<Responses["CHECK_TONE"]> {
    const res = await runModelCall("outgoing:" + msg.sessionId, async (backend, signal, timeoutMs) =>
      backend.judge(msg.text, msg.context, await allowedRecent(msg.recent, backend), { signal, timeoutMs }))
    return res.ok ? { ok: true, verdict: res.value } : res
  }

  async function getAdvice(msg: MessageOf<"GET_ADVICE">): Promise<Responses["GET_ADVICE"]> {
    const res = await runModelCall("outgoing:" + msg.sessionId, async (backend, signal, timeoutMs) =>
      backend.advise(msg.text, msg.verdict, msg.context, msg.style, await allowedRecent(msg.recent, backend), { signal, timeoutMs }),
      ADVICE_TIMEOUT_MS)
    if (!res.ok) return res

    const { verdict } = msg
    if (verdict.tone !== "green") {
      recordWeek("flagged", msg.eventId)
      // What a parent may see: no text, no contact (Plan 5.2)
      logEvent({
        id:         msg.eventId,
        tone:       verdict.tone,
        category:   res.value.category,
        confidence: verdict.confidence,
        platform:   msg.platform,
      }, true)
    }
    return { ok: true, advice: res.value }
  }

  /** Opt-in reading of a received message. Never logged or uploaded. */
  async function explainIncoming(msg: MessageOf<"READ_INCOMING">): Promise<Responses["READ_INCOMING"]> {
    if (!(await getSettings()).incomingAnalysis) return { ok: false, reason: "paused" }
    const res = await runModelCall("incoming:" + msg.key, (backend, signal, timeoutMs) =>
      backend.readIncoming(msg.text, { signal, timeoutMs }), CHECK_TIMEOUT_MS, "low")
    return res.ok ? { ok: true, analysis: res.value } : res
  }
})

/** Whether a URL matches a "scheme://host/*" pattern (the only kind excludeMatches uses here). */
function matchesPattern(url: string | undefined, pattern: string): boolean {
  return !!url && url.startsWith(pattern.replace(/\*$/, ""))
}

function failureReason(err: unknown): CheckFailure {
  if (err instanceof CancelledError) return err.message === "paused" ? "paused" : "cancelled"
  if (err instanceof BackendError) {
    switch (err.kind) {
      case "aborted":      return "cancelled"
      case "bad-response": return "error"
      case "unsupported":  return "offline"
      case "rate-limited": return "limit"
      default:             return err.kind
    }
  }
  return "error"
}

/**
 * Ollama rejects requests whose Origin isn't on its allow-list, and
 * chrome-extension:// origins aren't on it by default (HTTP 403). Rather than
 * asking every user to set OLLAMA_ORIGINS, strip the Origin header from this
 * extension's own requests to the local server. Session rules don't survive a
 * browser restart, so this runs on every worker start.
 */
function allowOllamaRequests() {
  browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "origin", operation: "remove" }],
      },
      condition: {
        requestDomains:   OLLAMA_HOSTS,
        initiatorDomains: [browser.runtime.id],
        resourceTypes:    ["xmlhttprequest", "other"],
      },
    }],
  }).catch(err => console.log("Sentiment Guide bg: could not install Ollama header rule —", err.message))
}
