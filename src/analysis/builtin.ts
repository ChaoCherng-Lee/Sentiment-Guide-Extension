// =============================================================================
// The "builtin" backend: Chrome's own AI, Gemini Nano, through the Prompt API
// (`LanguageModel`). It runs on this computer, so nothing leaves it, and
// there's nothing to install besides Chrome downloading the model once.
//
// Chrome's guidance: a GPU with more than 4 GB of memory, or 16 GB of RAM and
// 4+ CPU cores, and about 22 GB of free disk. Languages: en, es, de, fr, ja.
//
// The API isn't in every context: pages have it, workers may not. A "host"
// hides where it actually runs (this context, or the offscreen document; see
// offscreen-host.ts).
// =============================================================================

import { BackendError, type BackendStatus, callSignal, type ToneBackend } from "./backend"
import type { ChatTurn } from "./prompts"
import { promptBackend } from "./prompt-backend"

/** The parts of Chrome's `LanguageModel` this file uses. */
export interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>
  clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>
  destroy(): void
}

export type Availability = "unavailable" | "downloadable" | "downloading" | "available"

export interface LanguageModelCreateOptions {
  initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[]
  expectedInputs?: { type: "text"; languages: string[] }[]
  expectedOutputs?: { type: "text"; languages: string[] }[]
  monitor?(m: EventTarget): void
  signal?: AbortSignal
}

export interface LanguageModelAPI {
  availability(options?: LanguageModelCreateOptions): Promise<Availability>
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
}

/** Chrome's LanguageModel in this context, if it has one. */
export function languageModelHere(): LanguageModelAPI | undefined {
  return (globalThis as unknown as { LanguageModel?: LanguageModelAPI }).LanguageModel
}

/** Prompts are in English; messages may be in any of the model's languages. */
const LANGUAGES = {
  expectedInputs:  [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
}

/** Where the model runs, seen from the backend. */
export interface LanguageModelHost {
  availability(): Promise<Availability | "missing">
  /**
   * `initial`: every turn but the last; `input`: the last user turn. Answers
   * with the model's text (JSON matching `schema`).
   */
  prompt(initial: ChatTurn[], input: string, schema: object, signal: AbortSignal): Promise<string>
  warm(): Promise<void>
}

/**
 * A host for a context that has `LanguageModel` itself. Sessions for the
 * same opening turns (the same system prompt) are created once and cloned
 * for each check, which is much faster than starting over.
 */
export function directHost(lm: LanguageModelAPI): LanguageModelHost {
  const bases = new Map<string, Promise<LanguageModelSession>>()
  const MAX_BASES = 8

  function base(initial: ChatTurn[]): Promise<LanguageModelSession> {
    const key = JSON.stringify(initial)
    let s = bases.get(key)
    if (!s) {
      if (bases.size >= MAX_BASES) {
        const [oldKey, old] = bases.entries().next().value!
        bases.delete(oldKey)
        old.then(o => o.destroy(), () => {})
      }
      s = lm.create({ ...LANGUAGES, initialPrompts: initial.map(t => ({ role: t.role, content: t.content })) })
      s.catch(() => bases.delete(key))
      bases.set(key, s)
    }
    return s
  }

  return {
    async availability() {
      try {
        return await lm.availability(LANGUAGES)
      } catch (_) {
        return "unavailable"
      }
    },
    async prompt(initial, input, schema, signal) {
      const session = await (await base(initial)).clone({ signal })
      try {
        return await session.prompt(input, { responseConstraint: schema, signal })
      } finally {
        session.destroy()
      }
    },
    async warm() {
      (await lm.create(LANGUAGES)).destroy()
    },
  }
}

function asBackendError(err: unknown, signal: AbortSignal): BackendError {
  if (err instanceof BackendError) return err
  if (signal.aborted && signal.reason instanceof BackendError) return signal.reason
  const name = (err as Error)?.name
  if (name === "AbortError") return new BackendError("aborted", "request cancelled")
  if (name === "NotSupportedError") return new BackendError("unsupported", (err as Error).message)
  if (name === "NotAllowedError" || name === "InvalidStateError") return new BackendError("no-model", (err as Error).message)
  return new BackendError("bad-response", (err as Error)?.message ?? String(err))
}

const STATE: Record<Availability | "missing", BackendStatus> = {
  available:    { state: "ready", model: null },
  downloadable: { state: "downloadable", model: null, detail: "Chrome needs to download its AI model once" },
  downloading:  { state: "downloading", model: null, detail: "Chrome is downloading its AI model" },
  unavailable:  { state: "unsupported", model: null, detail: "This computer doesn't meet Chrome's requirements for built-in AI" },
  missing:      { state: "unsupported", model: null, detail: "This version of Chrome doesn't have built-in AI" },
}

/** The "builtin" backend, on whichever host `host()` gives. */
export function builtinBackend(host: () => Promise<LanguageModelHost>): ToneBackend {
  return promptBackend({
    id:    "builtin",
    local: true,
    async chat({ messages, format, ...opts }) {
      const last = messages.at(-1)
      if (!last || last.role !== "user") throw new BackendError("bad-response", "nothing to ask")
      const signal = callSignal(opts)
      let text: string
      try {
        const h = await host()
        if ((await h.availability()) !== "available") throw new BackendError("no-model", "Chrome's AI model isn't ready")
        text = await h.prompt(messages.slice(0, -1), last.content, format, signal)
      } catch (err) {
        throw asBackendError(err, signal)
      }
      try {
        return JSON.parse(text)
      } catch (_) {
        throw new BackendError("bad-response", "reply was not JSON")
      }
    },
    async status() {
      try {
        return STATE[await (await host()).availability()]
      } catch (_) {
        return STATE.missing
      }
    },
    isCold: async () => false,
    async warm() {
      const h = await host()
      if ((await h.availability()) === "available") await h.warm()
    },
  })
}

/**
 * Download Chrome's model, from a page the user just clicked in (Chrome asks
 * for a click before the first download). `onProgress` gets 0…1.
 */
export async function downloadBuiltinModel(onProgress: (fraction: number) => void): Promise<void> {
  const lm = languageModelHere()
  if (!lm) throw new BackendError("unsupported", "This version of Chrome doesn't have built-in AI")
  const session = await lm.create({
    ...LANGUAGES,
    monitor(m) {
      m.addEventListener("downloadprogress", e => onProgress((e as Event & { loaded: number }).loaded))
    },
  })
  session.destroy()
}
