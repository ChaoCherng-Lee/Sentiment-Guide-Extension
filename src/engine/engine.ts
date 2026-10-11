// =============================================================================
// Engine — wires a platform adapter to compose sessions, the shared popup and
// the per-chat context form. Each content script just calls startEngine().
// =============================================================================

import type { ChatContext } from "../analysis/types"
import { sendMessage } from "../messaging"
import type { PlatformAdapter } from "../platforms/types"
import { getChatData, updateChatData } from "../settings/store"
import { showContextForm } from "../ui/context-form"
import { StatusChip } from "../ui/status-chip"
import { SuggestionPopup } from "../ui/suggestion-popup"
import { ComposeSession } from "./compose-session"

const CONTEXT_TTL_MS     = 7 * 24 * 60 * 60 * 1000   // ask again after 7 days
const SCAN_THROTTLE_MS   = 500
const FORM_SETTLE_MS     = 800

export function startEngine(adapter: PlatformAdapter) {
  console.log("Sentiment Guide: loaded on", location.hostname)

  const popup    = new SuggestionPopup()
  const chip     = new StatusChip()
  const sessions = new Map<HTMLElement, ComposeSession>()
  const askedThisSession = new Set<string>()   // chats whose form we already offered

  const conversation: { id: string | null; context: ChatContext | null } = { id: null, context: null }

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
        conversation: () => conversation,
        onEditContext: openContextForm,
        onCheckDone: (outcome) => {
          if (outcome.ok) chip.set({ kind: "hidden" })
          else if (outcome.reason === "timeout") chip.set({ kind: "slow" })
          else if (outcome.reason === "offline" || outcome.reason === "no-model") chip.set({ kind: outcome.reason })
        },
      }))
    }
    chip.setAnchor([...sessions.keys()][0] ?? null)
  }

  // ── AI status ─────────────────────────────────────────────────────────────

  async function prepareModel() {
    const status = await sendMessage({ type: "AI_STATUS" })
    if (!status) return
    if (status.state === "offline" || status.state === "no-model") {
      chip.set({ kind: status.state })
      return
    }
    if (status.state === "idle") {
      // Load the model now so the first check isn't a minute-long wait
      chip.set({ kind: "loading" })
      await sendMessage({ type: "WARM_UP" })
      const after = await sendMessage({ type: "AI_STATUS" })
      if (chip.kind !== "loading") return   // a check already reported something newer
      chip.set(after?.state === "offline" || after?.state === "no-model" ? { kind: after.state } : { kind: "hidden" })
    }
  }

  // The page mutates constantly, so rescan at most every SCAN_THROTTLE_MS
  let scanQueued = false
  new MutationObserver(() => {
    if (scanQueued) return
    scanQueued = true
    setTimeout(() => { scanQueued = false; scan() }, SCAN_THROTTLE_MS)
  }).observe(document.documentElement, { childList: true, subtree: true })

  // ── Conversation switches ─────────────────────────────────────────────────

  async function onConversationChange() {
    const id = adapter.getConversationId()
    if (id === conversation.id) return
    conversation.id      = id
    conversation.context = null
    sessions.forEach(s => s.reset())
    if (!id) return

    const { context } = await getChatData(id)
    if (conversation.id !== id) return   // switched again while loading

    const fresh = context && Date.now() - context.savedAt < CONTEXT_TTL_MS
    if (context && (fresh || askedThisSession.has(id))) {
      conversation.context = context
      return
    }
    if (askedThisSession.has(id)) return
    askedThisSession.add(id)
    // Let the chat UI settle before sliding the form up
    setTimeout(() => { if (conversation.id === id) openContextForm() }, FORM_SETTLE_MS)
  }

  scan()
  prepareModel()
  onConversationChange()
  adapter.onConversationChange(onConversationChange)
}
