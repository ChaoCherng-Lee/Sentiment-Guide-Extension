// A backend made from a model that answers chats with JSON: Ollama and
// Chrome's built-in AI. The prompts are built here, on this computer.

import type { BackendId, BackendStatus, ChatJSON, ToneBackend } from "./backend"
import { readIncoming } from "./incoming"
import { adviseTone, judgeTone } from "./tone"

export interface PromptBackendParts {
  id: BackendId
  local: boolean
  chat: ChatJSON
  status(): Promise<BackendStatus>
  isCold(): Promise<boolean>
  warm(): Promise<void>
}

export function promptBackend(parts: PromptBackendParts): ToneBackend {
  const { chat } = parts
  return {
    id:     parts.id,
    local:  parts.local,
    status: () => parts.status(),
    isCold: () => parts.isCold(),
    warm:   () => parts.warm(),
    judge:  (text, context, recent, opts) => judgeTone(chat, text, context, opts, recent),
    advise: (text, verdict, context, style, recent, opts) => adviseTone(chat, text, verdict, context, style, opts, recent),
    readIncoming: (text, opts) => readIncoming(chat, text, opts),
  }
}
