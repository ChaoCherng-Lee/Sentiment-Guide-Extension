// =============================================================================
// Engine — wires a platform adapter to compose sessions, the shared popup,
// the status chip and the per-chat context form, and follows the on / off /
// pause settings. Each content script just calls startEngine().
// =============================================================================

import type { ChatContext } from "../analysis/types"
import { sendMessage } from "../messaging"
import type { PlatformAdapter } from "../platforms/types"
import {
  DEFAULT_SETTINGS, getChatData, getSettings, isActive, isConversationDisabled,
  setConversationDisabled, type Settings, subscribeSettings, updateChatData,
} from "../settings/store"
import { showContextForm } from "../ui/context-form"
import { StatusChip } from "../ui/status-chip"
import { SuggestionPopup } from "../ui/suggestion-popup"
import { ComposeSession } from "./compose-session"

const CONTEXT_TTL_MS   = 7 * 24 * 60 * 60 * 1000   // ask again after 7 days
const SCAN_THROTTLE_MS = 500
const FORM_SETTLE_MS   = 800

export function startEngine(adapter: PlatformAdapter) {
  console.log("Sentiment Guide: loaded on", location.hostname)

  const popup    = new SuggestionPopup()
  const chip     = new StatusChip()
  const sessions = new Map<HTMLElement, ComposeSession>()
  const askedThisSession = new Set<string>()   // chats whose form we already offered

  const conversation: { id: string | null; context: ChatContext | null } = { id: null, context: null }
  let settings: Settings = DEFAULT_SETTINGS
  let wasActive = false

  /** Checking runs only when on, not paused, and not turned off for this chat. */
  const active = () => isActive(settings) && !isConversationDisabled(settings, conversation.id)

  // ── On / off / pause ──────────────────────────────────────────────────────

  /** Bring the page in line with the settings and the current chat. */
  function applyActiveState() {
    const now = active()
    if (!now) {
      sessions.forEach(s => s.reset())   // hides popup and highlights
      if (!settings.enabled)                                     chip.hide()
      else if (!isActive(settings))                              chip.set({ kind: "paused", until: settings.pausedUntil! })
      else                                                       chip.set({ kind: "chat-off", onTurnOn: turnChatOn })
    } else if (!wasActive) {
      chip.hide()
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
      await updateChatData(id, { context: ctx })
      sendMessage({ type: "SAVE_CONTEXT", context: ctx, contactHash: id })
    })
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
      sessions.set(box, new ComposeSession(box, {
        adapter,
        popup,
        isActive: active,
        conversation: () => conversation,
        onEditContext: openContextForm,
        onDisableChat: turnChatOff,
        onCheckDone: (outcome) => {
          if (!active()) return
          if (outcome.ok) chip.hide()
          else if (outcome.reason === "timeout") chip.set({ kind: "slow" })
          else if (outcome.reason === "offline" || outcome.reason === "no-model") chip.set({ kind: outcome.reason })
        },
      }))
    }
    chip.setAnchor([...sessions.keys()][0] ?? null)
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
      chip.set({ kind: status.state })
      return
    }
    if (status.state === "idle") {
      // Load the model now so the first check isn't a minute-long wait
      chip.set({ kind: "loading" })
      await sendMessage({ type: "WARM_UP" })
      const after = await sendMessage({ type: "AI_STATUS" })
      if (chip.kind !== "loading") return   // something newer was reported meanwhile
      chip.set(after?.state === "offline" || after?.state === "no-model" ? { kind: after.state } : { kind: "hidden" })
    }
  }

  // ── Conversation switches ─────────────────────────────────────────────────

  async function onConversationChange() {
    const id = adapter.getConversationId()
    if (id === conversation.id) return
    conversation.id      = id
    conversation.context = null
    sessions.forEach(s => s.reset())
    applyActiveState()
    if (!id) return

    const { context } = await getChatData(id)
    if (conversation.id !== id) return   // switched again while loading

    const fresh = context && Date.now() - context.savedAt < CONTEXT_TTL_MS
    if (context && (fresh || askedThisSession.has(id))) {
      conversation.context = context
      return
    }
    // Don't ask about chats the user isn't checking
    if (askedThisSession.has(id) || !active()) return
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
