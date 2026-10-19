// =============================================================================
// Ollama client — the only module that talks to the model.
//
// The address is fixed to this computer. The privacy promise ("messages never
// leave your device") depends on it, so it is deliberately not a setting.
// =============================================================================

import type { ChatTurn } from "./prompts"

export const OLLAMA_URL = "http://127.0.0.1:11434"
/** Match patterns for the Ollama server — used for host permissions and header rules. */
export const OLLAMA_HOSTS = ["127.0.0.1", "localhost"]

/**
 * Whether the model runs on this computer. Chat context (the other person's
 * messages) is only ever sent to a local model — if a remote one is added,
 * this turns it off.
 */
export const MODEL_IS_LOCAL = OLLAMA_HOSTS.includes(new URL(OLLAMA_URL).hostname)

/** Keep the model loaded between checks; a cold load can take over a minute. */
const KEEP_ALIVE = "30m"
const PREFERRED_MODELS = ["gemma3:4b", "gemma3:latest"]

export class OllamaError extends Error {
  constructor(readonly kind: "offline" | "no-model" | "timeout" | "aborted" | "bad-response", message: string) {
    super(message)
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const res = await fetch(OLLAMA_URL + path, init)
    if (res.status === 404 && path === "/api/chat") throw new OllamaError("no-model", "model not found")
    if (!res.ok) throw new OllamaError("bad-response", `Ollama HTTP ${res.status}`)
    return res
  } catch (err) {
    if (err instanceof OllamaError) throw err
    if ((err as Error).name === "AbortError") {
      const reason = init.signal?.reason
      throw reason instanceof OllamaError ? reason : new OllamaError("aborted", "request cancelled")
    }
    throw new OllamaError("offline", (err as Error).message)
  }
}

export async function listModels(): Promise<string[]> {
  const res  = await request("/api/tags", { signal: AbortSignal.timeout(3000) })
  const data = await res.json()
  return (data.models ?? []).map((m: { name: string }) => m.name)
}

/** Pick the model: the user's choice if installed, else the best Gemma we can find. */
export function pickModel(installed: string[], preferred: string | null): string | null {
  if (preferred && installed.includes(preferred)) return preferred
  return PREFERRED_MODELS.find(m => installed.includes(m))
    ?? installed.find(n => n.startsWith("gemma3"))
    ?? installed.find(n => n.startsWith("gemma"))
    ?? null
}

export interface ChatOptions {
  model: string
  messages: ChatTurn[]
  /** JSON schema the reply must match (structured outputs). */
  format?: object
  signal?: AbortSignal
  timeoutMs?: number
}

/** One non-streaming chat call. Returns the parsed JSON reply. */
export async function chatJSON({ model, messages, format, signal, timeoutMs = 60_000 }: ChatOptions): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const ctrl    = new AbortController()
  const abort   = (reason: unknown) => { if (!ctrl.signal.aborted) ctrl.abort(reason) }
  timeout.addEventListener("abort", () => abort(new OllamaError("timeout", `no reply after ${timeoutMs} ms`)))
  signal?.addEventListener("abort", () => abort(new OllamaError("aborted", "request cancelled")))
  if (signal?.aborted) abort(new OllamaError("aborted", "request cancelled"))

  const res = await request("/api/chat", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      model,
      messages,
      format,
      stream:     false,
      keep_alive: KEEP_ALIVE,
      options:    { temperature: 0.2 },
    }),
    signal: ctrl.signal,
  })
  const data = await res.json()
  if (data.error) throw new OllamaError("bad-response", data.error)
  try {
    return JSON.parse(data.message?.content ?? "")
  } catch (_) {
    throw new OllamaError("bad-response", "reply was not JSON")
  }
}

/** Load the model into memory ahead of the first check. */
export async function warmUp(model: string): Promise<void> {
  await request("/api/chat", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model, messages: [], keep_alive: KEEP_ALIVE }),
  })
}

/** Whether the model is already loaded (so a check will be fast). */
export async function isLoaded(model: string): Promise<boolean> {
  try {
    const res  = await request("/api/ps", { signal: AbortSignal.timeout(3000) })
    const data = await res.json()
    return (data.models ?? []).some((m: { name: string }) => m.name === model)
  } catch (_) {
    return false
  }
}
