// =============================================================================
// Ollama client and the "ollama" backend (backend.ts): the advanced, fully
// private choice, a model running on this computer.
//
// The address is fixed to this computer. The privacy promise ("messages never
// leave your device") depends on it, so it is deliberately not a setting.
// =============================================================================

import { BackendError, type BackendStatus, callSignal, type ToneBackend } from "./backend"
import type { ChatTurn } from "./prompts"
import { promptBackend } from "./prompt-backend"

export const OLLAMA_URL = "http://127.0.0.1:11434"
/** Match patterns for the Ollama server — used for host permissions and header rules. */
export const OLLAMA_HOSTS = ["127.0.0.1", "localhost"]

/** Always this computer (see above); chat context depends on it. */
const MODEL_IS_LOCAL = OLLAMA_HOSTS.includes(new URL(OLLAMA_URL).hostname)

/** Keep the model loaded between checks; a cold load can take over a minute. */
const KEEP_ALIVE = "30m"
const PREFERRED_MODELS = ["gemma3:4b", "gemma3:latest"]


async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const res = await fetch(OLLAMA_URL + path, init)
    if (res.status === 404 && path === "/api/chat") throw new BackendError("no-model", "model not found")
    if (!res.ok) throw new BackendError("bad-response", `Ollama HTTP ${res.status}`)
    return res
  } catch (err) {
    if (err instanceof BackendError) throw err
    if ((err as Error).name === "AbortError") {
      const reason = init.signal?.reason
      throw reason instanceof BackendError ? reason : new BackendError("aborted", "request cancelled")
    }
    throw new BackendError("offline", (err as Error).message)
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
  const callAbort = callSignal({ signal, timeoutMs })
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
    signal: callAbort,
  })
  const data = await res.json()
  if (data.error) throw new BackendError("bad-response", data.error)
  try {
    return JSON.parse(data.message?.content ?? "")
  } catch (_) {
    throw new BackendError("bad-response", "reply was not JSON")
  }
}

/** The model the setup page downloads. */
export const SETUP_MODEL = PREFERRED_MODELS[0]

/** One line of Ollama's download progress. Large layers report total/completed bytes. */
export interface PullUpdate {
  status: string
  digest?: string
  total?: number
  completed?: number
}

/**
 * Overall progress of a download made of several layers: bytes done and
 * bytes in total so far, across every layer seen. Layers are announced as
 * they start, so the total can grow a little as the download goes on.
 */
export function pullProgress(updates: Iterable<PullUpdate>): { completed: number; total: number } {
  const layers = new Map<string, { total: number; completed: number }>()
  for (const u of updates) {
    if (!u.digest || !u.total) continue
    layers.set(u.digest, { total: u.total, completed: Math.min(u.completed ?? 0, u.total) })
  }
  let completed = 0, total = 0
  for (const l of layers.values()) { completed += l.completed; total += l.total }
  return { completed, total }
}

/**
 * Download a model, reporting each progress line. Ollama keeps partly
 * downloaded layers, so a download that stops can be started again and
 * picks up where it left off.
 */
export async function pullModel(model: string, onUpdate: (u: PullUpdate) => void, signal?: AbortSignal): Promise<void> {
  const res = await request("/api/pull", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model, stream: true }),
    signal,
  })
  if (!res.body) throw new BackendError("bad-response", "no download progress")
  const reader  = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ""
  let done = false
  while (!done) {
    const chunk = await reader.read()
    done = chunk.done
    buffered += chunk.value ?? ""
    const lines = buffered.split("\n")
    buffered = done ? "" : lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      const u = JSON.parse(line) as PullUpdate & { error?: string }
      if (u.error) throw new BackendError("bad-response", u.error)
      onUpdate(u)
    }
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

/** The model to use: the user's choice if installed, else the best Gemma installed. */
export async function resolveModel(preferred: string | null): Promise<string> {
  const model = pickModel(await listModels(), preferred)
  if (!model) throw new BackendError("no-model", "no Gemma model installed")
  return model
}

/**
 * The "ollama" backend. `preferred` is read for every call, so a model
 * picked in Settings applies straight away.
 */
export function ollamaBackend(preferred: () => Promise<string | null> | string | null = () => null): ToneBackend {
  const model = async () => resolveModel(await preferred())
  return promptBackend({
    id:    "ollama",
    local: MODEL_IS_LOCAL,
    chat:  async (req) => chatJSON({ ...req, model: await model() }),
    async status(): Promise<BackendStatus> {
      try {
        const m = await model()
        return { state: (await isLoaded(m)) ? "ready" : "idle", model: m }
      } catch (err) {
        const state = err instanceof BackendError && err.kind === "no-model" ? "no-model" : "offline"
        return { state, model: null }
      }
    },
    isCold: async () => !(await isLoaded(await model())),
    async warm() {
      const m = await model()
      if (!(await isLoaded(m))) await warmUp(m)
    },
  })
}
