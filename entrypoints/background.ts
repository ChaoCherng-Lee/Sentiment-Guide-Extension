// =============================================================================
// background.ts
// Service worker. Runs tone analysis against the local Ollama server through
// a priority queue, reports AI status, and does optional Supabase logging.
// =============================================================================

import { browser, defineBackground } from "#imports"
import { listModels, OLLAMA_HOSTS, OllamaError, isLoaded, pickModel, warmUp } from "../src/analysis/ollama"
import { CancelledError, RequestQueue } from "../src/analysis/queue"
import { analyseTone } from "../src/analysis/tone"
import type { ChatContext } from "../src/analysis/types"
import { logAcceptance, logContext, logEvent, getChildId } from "../src/backend/supabase"
import type { AIStatus, CheckFailure, CheckToneResponse, Message } from "../src/messaging"
import { getSettings } from "../src/settings/store"

const CHECK_TIMEOUT_MS      = 30_000
/** First check after the model was unloaded includes loading it — allow for that */
const COLD_CHECK_TIMEOUT_MS = 120_000

export default defineBackground(() => {
  console.log("Sentiment Guide: background worker started")

  const queue = new RequestQueue(1)
  let warming: Promise<void> | null = null

  allowOllamaRequests()

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      getChildId()
      browser.tabs.create({ url: browser.runtime.getURL("/onboarding.html") })
    }
  })

  browser.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return

    switch (msg.type) {
      case "CHECK_TONE":
        checkTone(msg.text, msg.context, msg.eventId, msg.contactHash, msg.sessionId).then(sendResponse)
        return true
      case "AI_STATUS":
        getStatus().then(sendResponse)
        return true
      case "WARM_UP":
        warm().then(() => sendResponse(), () => sendResponse())
        return true
      case "SAVE_CONTEXT":
        logContext(msg.context, msg.contactHash)
        return false
      case "UPDATE_ACCEPTANCE":
        logAcceptance(msg.eventId, msg.accepted)
        return false
    }
  })

  // ── Model ─────────────────────────────────────────────────────────────────

  async function resolveModel(): Promise<string> {
    const [installed, settings] = await Promise.all([listModels(), getSettings()])
    const model = pickModel(installed, settings.model)
    if (!model) throw new OllamaError("no-model", "no Gemma model installed")
    return model
  }

  async function getStatus(): Promise<AIStatus> {
    try {
      const model = await resolveModel()
      return { state: (await isLoaded(model)) ? "ready" : "idle", model }
    } catch (err) {
      const kind = err instanceof OllamaError && err.kind === "no-model" ? "no-model" : "offline"
      return { state: kind, model: null }
    }
  }

  function warm(): Promise<void> {
    warming ??= (async () => {
      const model = await resolveModel()
      if (!(await isLoaded(model))) await warmUp(model)
    })().finally(() => { warming = null })
    return warming
  }

  // ── Tone check ────────────────────────────────────────────────────────────

  async function checkTone(
    text: string,
    context: ChatContext | null,
    eventId: string,
    contactHash: string | null,
    sessionId: string,
  ): Promise<CheckToneResponse> {
    try {
      // A newer check from the same compose box replaces this one
      const result = await queue.add(async (signal) => {
        const model = await resolveModel()
        const cold  = !(await isLoaded(model))
        return analyseTone(text, context, {
          model,
          signal,
          timeoutMs: cold ? COLD_CHECK_TIMEOUT_MS : CHECK_TIMEOUT_MS,
        })
      }, { priority: "high", key: "outgoing:" + sessionId })

      // Store yellow/red events in Supabase (green = nothing to log)
      if (result.tone !== "green") {
        logEvent({
          id: eventId,
          contact_hash: contactHash,
          tone: result.tone,
          confidence: result.confidence,
          label: result.label,
          flagged_phrase: result.flagged_phrase,
          suggestion: result.suggestion,
          tone_tags_detected: result.tone_tags_detected,
        })
      }
      return { ok: true, result }
    } catch (err) {
      const reason = failureReason(err)
      if (reason !== "cancelled") console.log("Sentiment Guide bg: check failed —", reason, (err as Error).message)
      return { ok: false, reason }
    }
  }
})

function failureReason(err: unknown): CheckFailure {
  if (err instanceof CancelledError) return "cancelled"
  if (err instanceof OllamaError) {
    if (err.kind === "aborted") return "cancelled"
    if (err.kind === "bad-response") return "error"
    return err.kind
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
