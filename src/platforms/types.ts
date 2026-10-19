import type { ChatMessage, Platform, SuggestionStyle } from "../analysis/types"

export type { ChatMessage }

export interface IncomingMessage {
  /** Stable per message, used to cache results for the session. */
  key: string
  text: string
  /** The message element (bubble or email body). */
  element: HTMLElement
  /** Where the badge goes, if not at the end of `element`. */
  anchor?: HTMLElement
}

/**
 * Everything that depends on a site's page structure. The rest of the
 * extension never queries the page's DOM directly — adding a site means
 * writing one of these.
 */
export interface PlatformAdapter {
  id: Exclude<Platform, "outlook">
  findComposeBoxes(): HTMLElement[]
  /** Plain text currently in a compose box. */
  getText(box: HTMLElement): string
  /** Hashed before leaving the adapter. */
  getConversationId(): string | null
  /** Display name for the context form. Never sent anywhere. */
  getConversationTitle(): string | null
  /** Last `limit` text messages in the open chat, oldest first. Raw — scrub with prepareRecent(). */
  getRecentMessages(limit: number): ChatMessage[]
  observeIncoming(cb: (msg: IncomingMessage) => void): () => void
  /** Replace the whole text ("all") or one range. Resolves true if the text changed. */
  replaceText(box: HTMLElement, range: Range | "all", text: string): Promise<boolean>
  /** Fires when the user sends the message in `box` (Enter or the send button). */
  onSend(box: HTMLElement, cb: () => void): () => void
  onConversationChange(cb: () => void): () => void

  // ── Optional, for long-form sites like email ──────────────────────────────

  /** The text checked after a pause, if not the whole message (Gmail: the paragraph being edited). */
  getEditingText?(box: HTMLElement): string
  /** Rewrite style when none was picked for the conversation (Gmail: formal). */
  defaultStyle?: SuggestionStyle
  /** Offer the context form when a conversation opens. Default true. */
  askContextOnOpen?: boolean
  /**
   * Hold sending until `check` resolves: true lets the message go, false
   * keeps it (Gmail checks the whole email when Send is pressed).
   */
  guardSend?(box: HTMLElement, check: () => Promise<boolean>): () => void
  /** Send now, past the guard ("Send anyway"). */
  sendNow?(box: HTMLElement): void
}
