// =============================================================================
// Settings store — one typed source of truth shared by the popup, options
// page, background worker and content scripts.
//
// Preferences live in chrome.storage.sync (they follow the user between
// browsers). Per-chat data lives in chrome.storage.local, keyed by a hash of
// the conversation — never by name.
// =============================================================================

import { browser } from "#imports"
import type { ChatContext } from "../analysis/types"

export interface Settings {
  /** Main on/off switch. */
  enabled: boolean
  /** Paused until this time (ms since epoch); null = not paused. */
  pausedUntil: number | null
  /** Hashed conversation IDs the user switched checking off for. */
  disabledConversations: string[]
  /** Ollama model to use; null picks the best installed Gemma model. */
  model: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  pausedUntil: null,
  disabledConversations: [],
  model: null,
}

/** chrome.storage.sync caps an item at 8 KB — keep the newest chats only. */
export const MAX_DISABLED_CONVERSATIONS = 200

/** Whether the extension should check messages right now. */
export function isActive(s: Settings, now = Date.now()): boolean {
  return s.enabled && !(s.pausedUntil !== null && s.pausedUntil > now)
}

/** Whether checking is off for one conversation (on top of the global switch). */
export function isConversationDisabled(s: Settings, conversationId: string | null): boolean {
  return conversationId !== null && s.disabledConversations.includes(conversationId)
}

export async function setConversationDisabled(conversationId: string, disabled: boolean) {
  const { disabledConversations } = await getSettings()
  const rest = disabledConversations.filter(id => id !== conversationId)
  await updateSettings({
    disabledConversations: disabled ? [...rest, conversationId].slice(-MAX_DISABLED_CONVERSATIONS) : rest,
  })
}

/** Pause until `until` (ms since epoch). Turns the extension on if it was off. */
export function pauseUntil(until: number) {
  return updateSettings({ enabled: true, pausedUntil: until })
}

/** 7 am tomorrow, local time — "pause until tomorrow". */
export function tomorrowMorning(now = new Date()): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(7, 0, 0, 0)
  return d.getTime()
}

export function resume() {
  return updateSettings({ enabled: true, pausedUntil: null })
}

export function setEnabled(enabled: boolean) {
  return updateSettings({ enabled, pausedUntil: null })
}

const SETTINGS_KEY = "settings"

export async function getSettings(): Promise<Settings> {
  const data = await browser.storage.sync.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as Partial<Settings> | undefined) }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await browser.storage.sync.set({ [SETTINGS_KEY]: next })
  return next
}

/** Calls `cb` with the full settings whenever they change anywhere. Returns an unsubscribe function. */
export function subscribeSettings(cb: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "sync" || !(SETTINGS_KEY in changes)) return
    cb({ ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined) })
  }
  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}

// -----------------------------------------------------------------------------
// Per-chat data
// -----------------------------------------------------------------------------

export interface ChatData {
  context?: ChatContext
}

const chatKey = (hash: string) => "chat_" + hash

export async function getChatData(hash: string): Promise<ChatData> {
  const data = await browser.storage.local.get(chatKey(hash))
  return (data[chatKey(hash)] as ChatData | undefined) ?? {}
}

export async function updateChatData(hash: string, patch: Partial<ChatData>): Promise<ChatData> {
  const next = { ...(await getChatData(hash)), ...patch }
  await browser.storage.local.set({ [chatKey(hash)]: next })
  return next
}
