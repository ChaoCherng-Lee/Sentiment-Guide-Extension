import type { ChatMessage, Platform } from "../analysis/types"

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
}
