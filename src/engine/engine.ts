// =============================================================================
// Engine — wires a platform adapter to compose sessions (each with its status
// badge), the shared popup and the per-chat context form, and follows the
// on / off / pause settings. Each content script just calls startEngine().
// =============================================================================

import { prepareRecent, RECENT_LIMIT } from "../analysis/chat-context"
import type { ChatContext, SuggestionStyle } from "../analysis/types"
import { sendMessage } from "../messaging"
import type { PlatformAdapter } from "../platforms/types"
import {
  DEFAULT_SETTINGS, getChatData, getSettings, isActive, isConversationDisabled, pauseUntil, resolveStyle, resume,
  setConversationDisabled, type Settings, subscribeSettings, updateChatData, updateSettings,
} from "../settings/store"
import { showContextForm } from "../ui/context-form"
import type { PageState } from "../ui/status-badge"
import { SuggestionPopup } from "../ui/suggestion-popup"
import { ComposeSession } from "./compose-session"
import { IncomingWatcher } from "./incoming-watcher"

const CONTEXT_TTL_MS   = 7 * 24 * 60 * 60 * 1000   // ask again after 7 days
const SCAN_THROTTLE_MS = 500
const FORM_SETTLE_MS   = 800
const HOUR_MS          = 60 * 60 * 1000

export function startEngine(adapter: PlatformAdapter) {
  console.log("Sentiment Guide: loaded on", location.hostname)

  const popup    = new SuggestionPopup()
  const sessions = new Map<HTMLElement, ComposeSession>()
  const incoming = new IncomingWatcher(adapter)
  const askedThisSession = new Set<string>()   // chats whose form we already offered

  const conversation: {
    id: string | null
    context: ChatContext | null
    /** Style picked for this chat in the popup, if any */
    style: SuggestionStyle | undefined
  } = { id: null, context: null, style: undefined }
  let settings: Settings = DEFAULT_SETTINGS

  // Before the context form is filled in, the model still learns which site
  // this is (e.g. email is judged as semi-formal). WhatsApp needs no note.
  const siteOnlyContext: ChatContext | null = adapter.id === "whatsapp"
    ? null
    : { platform: adapter.id, q1: "", q2: "", q3: "", q4: "", q5: "", savedAt: 0 }
  let wasActive = false

  /** Checking runs only when on, not paused, and not turned off for this chat. */
  const active = () => isActive(settings) && !isConversationDisabled(settings, conversation.id)

  // ── Badges ────────────────────────────────────────────────────────────────

  /** AI status, pause and chat-off, shown on every box's badge. */
  let page: PageState = { kind: "ok" }
  function setPage(state: PageState) {
    page = state
    sessions.forEach(s => s.setPageState(state))
  }

  const badgeActions = {
    openSetup:    () => { sendMessage({ type: "OPEN_PAGE", page: "setup" }) },
    openSettings: () => { sendMessage({ type: "OPEN_PAGE", page: "settings" }) },
    pauseHour:    () => { pauseUntil(Date.now() + HOUR_MS) },
    resume:       () => { resume() },
    setChatChecking: (on: boolean) => on ? turnChatOn() : turnChatOff(),
    scope: "chat" as const,
  }

  // ── On / off / pause ──────────────────────────────────────────────────────

  /** Bring the page in line with the settings and the current chat. */
  function applyActiveState() {
    const now = active()
    // Incoming readings follow the same switches, plus their own opt-in
    incoming.setEnabled(now && settings.incomingAnalysis)
    sessions.forEach(s => s.setHidden(!settings.enabled))
    if (!now) {
      sessions.forEach(s => s.reset())   // hides popup and highlights
      if (!settings.enabled)       setPage({ kind: "ok" })
      else if (!isActive(settings)) setPage({ kind: "paused", until: settings.pausedUntil! })
      else                          setPage({ kind: "chat-off" })
    } else if (!wasActive) {
      setPage({ kind: "ok" })
      prepareModel()
    }
    wasActive = now
  }

  function turnChatOn() {
    if (conversation.id) setConversationDisabled(conversation.id, false)
  }

  function turnChatOff() {
    if (conversation.id) setConversationDisabled(conversation.id, true)
  }

  // ── Context form ──────────────────────────────────────────────────────────

  function openContextForm() {
    const id = conversation.id ?? adapter.getConversationId()
    if (!id) return
    const title = adapter.getConversationTitle() ?? "this person"
    showContextForm(title, adapter.id, async (ctx) => {
      if (conversation.id === id) conversation.context = ctx
      // Kept on this computer only — context answers are never uploaded (Plan 5.2)
      await updateChatData(id, { context: ctx })
    })
  }

  // ── Chat context (opt-in) ──────────────────────────────────────────────────

  /** Settings are updated locally too, so the next check sees the change at once. */
  function patchSettings(patch: Partial<Settings>) {
    settings = { ...settings, ...patch }
    updateSettings(patch)
  }

  const chatContext = {
    // Read from the page at check time and scrubbed here, before it leaves the page
    recent: () => settings.chatContext
      ? prepareRecent(adapter.getRecentMessages(RECENT_LIMIT), [adapter.getConversationTitle()])
      : [],
    takeOffer: () => {
      if (settings.chatContext || settings.chatContextOffered) return false
      patchSettings({ chatContextOffered: true })
      return true
    },
    choose: (on: boolean) => patchSettings({ chatContext: on, chatContextOffered: true }),
  }

  // ── Compose boxes ─────────────────────────────────────────────────────────

  function scan() {
    const boxes = new Set(adapter.findComposeBoxes())
    for (const [box, session] of sessions) {
      if (!boxes.has(box) || !document.contains(box)) {
        session.dispose()
        sessions.delete(box)
      }
    }
    for (const box of boxes) {
      if (sessions.has(box)) continue
      const session = new ComposeSession(box, {
        adapter,
        popup,
        isActive: active,
        conversation: () => ({ id: conversation.id, context: conversation.context ?? siteOnlyContext }),
        onEditContext: openContextForm,
        onDisableChat: turnChatOff,
        style: () => resolveStyle(settings, { context: conversation.context ?? undefined, style: conversation.style }, adapter.defaultStyle),
        onStyleChange: (style) => {
          conversation.style = style
          if (conversation.id) updateChatData(conversation.id, { style })
        },
        onCheckDone: (outcome) => {
          if (!active()) return
          if (outcome.ok) { if (page.kind !== "ok") setPage({ kind: "ok" }) }
          else if (outcome.reason === "timeout") setPage({ kind: "slow" })
          else if (outcome.reason === "offline" || outcome.reason === "no-model") setPage({ kind: outcome.reason })
        },
        badge: badgeActions,
        chatContext,
      })
      session.setPageState(page)
      session.setHidden(!settings.enabled)
      sessions.set(box, session)
    }
  }

  // The page mutates constantly, so rescan at most every SCAN_THROTTLE_MS
  let scanQueued = false
  new MutationObserver(() => {
    if (scanQueued) return
    scanQueued = true
    setTimeout(() => { scanQueued = false; scan() }, SCAN_THROTTLE_MS)
  }).observe(document.documentElement, { childList: true, subtree: true })

  // ── AI status ─────────────────────────────────────────────────────────────

  async function prepareModel() {
    const status = await sendMessage({ type: "AI_STATUS" })
    if (!status || !active()) return
    if (status.state === "offline" || status.state === "no-model") {
      setPage({ kind: status.state })
      return
    }
    if (status.state === "idle") {
      // Load the model now so the first check isn't a minute-long wait
      setPage({ kind: "loading" })
      await sendMessage({ type: "WARM_UP" })
      const after = await sendMessage({ type: "AI_STATUS" })
      if (page.kind !== "loading") return   // something newer was reported meanwhile
      setPage(after?.state === "offline" || after?.state === "no-model" ? { kind: after.state } : { kind: "ok" })
    }
  }

  // ── Conversation switches ─────────────────────────────────────────────────

  async function onConversationChange() {
    const id = adapter.getConversationId()
    if (id === conversation.id) return
    conversation.id      = id
    conversation.context = null
    conversation.style   = undefined
    sessions.forEach(s => s.reset())
    applyActiveState()
    if (!id) return

    const { context, style } = await getChatData(id)
    if (conversation.id !== id) return   // switched again while loading
    conversation.style = style

    const fresh = context && Date.now() - context.savedAt < CONTEXT_TTL_MS
    if (context && (fresh || askedThisSession.has(id))) {
      conversation.context = context
      return
    }
    // Don't ask about chats the user isn't checking, or where it would nag (email)
    if (askedThisSession.has(id) || !active() || adapter.askContextOnOpen === false) return
    askedThisSession.add(id)
    // Let the chat UI settle before sliding the form up
    setTimeout(() => { if (conversation.id === id && active()) openContextForm() }, FORM_SETTLE_MS)
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  scan()
  getSettings().then(s => {
    settings = s
    applyActiveState()
    onConversationChange()
  })
  subscribeSettings(s => {
    settings = s
    applyActiveState()
  })
  adapter.onConversationChange(onConversationChange)
}
