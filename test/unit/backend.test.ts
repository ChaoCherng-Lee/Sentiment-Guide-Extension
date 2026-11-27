import { afterEach, describe, expect, it, vi } from "vitest"
import { BackendError, callSignal } from "../../src/analysis/backend"
import { ollamaBackend } from "../../src/analysis/ollama"

/** A fake Ollama: which models are installed and loaded, and what /api/chat answers. */
function fakeOllama(opts: { installed?: string[]; loaded?: string[]; reply?: unknown; down?: boolean } = {}) {
  const chats: { model: string; messages: { role: string; content: string }[]; format: unknown }[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (opts.down) throw new TypeError("Failed to fetch")
    const path = new URL(url).pathname
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (path === "/api/tags") return json({ models: (opts.installed ?? ["gemma3:4b"]).map(name => ({ name })) })
    if (path === "/api/ps") return json({ models: (opts.loaded ?? []).map(name => ({ name })) })
    if (path === "/api/chat") {
      chats.push(JSON.parse(init!.body as string))
      return json({ message: { content: JSON.stringify(opts.reply ?? {}) } })
    }
    return new Response(null, { status: 404 })
  }))
  return chats
}

afterEach(() => { vi.unstubAllGlobals() })

describe("ollama backend", () => {
  it("is on this computer, so chat context may go to it", () => {
    expect(ollamaBackend().local).toBe(true)
    expect(ollamaBackend().id).toBe("ollama")
  })

  it("reports ready, idle (not loaded), no-model and offline", async () => {
    fakeOllama({ loaded: ["gemma3:4b"] })
    expect(await ollamaBackend().status()).toEqual({ state: "ready", model: "gemma3:4b" })
    fakeOllama({ loaded: [] })
    expect(await ollamaBackend().status()).toEqual({ state: "idle", model: "gemma3:4b" })
    fakeOllama({ installed: ["llama3"] })
    expect((await ollamaBackend().status()).state).toBe("no-model")
    fakeOllama({ down: true })
    expect((await ollamaBackend().status()).state).toBe("offline")
  })

  it("is cold until the model is loaded", async () => {
    fakeOllama({ loaded: [] })
    expect(await ollamaBackend().isCold()).toBe(true)
    fakeOllama({ loaded: ["gemma3:4b"] })
    expect(await ollamaBackend().isCold()).toBe(false)
  })

  it("judges with the verdict schema on the model the user picked, and checks the answer", async () => {
    const chats = fakeOllama({
      installed: ["gemma3:4b", "gemma3:12b"],
      reply: { tone: "red", confidence: 0.9, flagged_phrase: "stupid", tone_tags_detected: false },
    })
    const verdict = await ollamaBackend(() => "gemma3:12b").judge("you are stupid", null, [])
    expect(verdict.tone).toBe("red")
    expect(verdict.flagged_phrase).toBe("stupid")
    expect(chats[0].model).toBe("gemma3:12b")
    expect(chats[0].format).toMatchObject({ type: "object" })
    expect(chats[0].messages.at(-1)!.content).toContain("you are stupid")
  })

  it("lets a laughing tease through in a very casual chat (the banter rule still applies)", async () => {
    fakeOllama({ reply: { tone: "yellow", confidence: 0.8, flagged_phrase: "idiot", tone_tags_detected: false } })
    const verdict = await ollamaBackend().judge("you idiot 😂", { platform: "whatsapp", q1: "close_friend", q2: "very_casual", q3: "yes", q4: "yes", q5: "normal", savedAt: 0 }, [])
    expect(verdict.tone).toBe("green")
  })

  it("says no-model when nothing suitable is installed", async () => {
    fakeOllama({ installed: [] })
    await expect(ollamaBackend().judge("hi there", null, [])).rejects.toMatchObject({ kind: "no-model" })
  })
})

describe("callSignal", () => {
  it("aborts with a timeout error", async () => {
    vi.useFakeTimers()
    const signal = callSignal({ timeoutMs: 50 })
    vi.advanceTimersByTime(60)
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(BackendError)
    expect((signal.reason as BackendError).kind).toBe("timeout")
    vi.useRealTimers()
  })

  it("aborts as cancelled when the caller gives up", () => {
    const ctrl = new AbortController()
    const signal = callSignal({ signal: ctrl.signal, timeoutMs: 10_000 })
    ctrl.abort()
    expect((signal.reason as BackendError).kind).toBe("aborted")
  })
})
