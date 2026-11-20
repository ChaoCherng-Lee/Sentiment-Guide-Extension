import { describe, expect, it, vi } from "vitest"
import {
  type Availability, builtinBackend, directHost, type LanguageModelAPI, type LanguageModelCreateOptions,
} from "../../src/analysis/builtin"

/** A stand-in for Chrome's LanguageModel that answers with `reply` (or throws `fail`). */
function fakeLM(opts: { availability?: Availability; reply?: unknown; fail?: Error } = {}) {
  const created: LanguageModelCreateOptions[] = []
  const prompts: { input: string; schema?: object }[] = []
  const session = (initial: LanguageModelCreateOptions) => ({
    async prompt(input: string, o?: { responseConstraint?: object; signal?: AbortSignal }) {
      if (opts.fail) throw opts.fail
      if (o?.signal?.aborted) throw new DOMException("aborted", "AbortError")
      prompts.push({ input, schema: o?.responseConstraint })
      return JSON.stringify(opts.reply ?? {})
    },
    async clone() { return session(initial) },
    destroy: vi.fn(),
  })
  const lm: LanguageModelAPI = {
    availability: async () => opts.availability ?? "available",
    async create(o = {}) { created.push(o); return session(o) },
  }
  return { lm, created, prompts }
}

const RED = { tone: "red", confidence: 0.9, flagged_phrase: "stupid", tone_tags_detected: false }

describe("built-in AI backend", () => {
  it("runs on this computer", () => {
    const b = builtinBackend(async () => directHost(fakeLM().lm))
    expect(b.id).toBe("builtin")
    expect(b.local).toBe(true)
  })

  it("says what Chrome says about the model", async () => {
    for (const [availability, state] of [
      ["available", "ready"], ["downloadable", "downloadable"], ["downloading", "downloading"], ["unavailable", "unsupported"],
    ] as const) {
      const b = builtinBackend(async () => directHost(fakeLM({ availability }).lm))
      expect((await b.status()).state).toBe(state)
    }
  })

  it("says unsupported when this Chrome has no built-in AI", async () => {
    const b = builtinBackend(async () => { throw new Error("no LanguageModel") })
    expect(await b.status()).toMatchObject({ state: "unsupported" })
  })

  it("asks with the system prompt up front and the message last, constrained to the schema", async () => {
    const { lm, created, prompts } = fakeLM({ reply: RED })
    const b = builtinBackend(async () => directHost(lm))
    const verdict = await b.judge("you are stupid", null, [])
    expect(verdict).toMatchObject({ tone: "red", flagged_phrase: "stupid" })
    expect(created[0].initialPrompts?.[0].role).toBe("system")
    expect(prompts[0].input).toContain("you are stupid")
    expect(prompts[0].schema).toMatchObject({ type: "object" })
  })

  it("starts a session once per system prompt and clones it for each check", async () => {
    const { lm, created } = fakeLM({ reply: RED })
    const host = directHost(lm)
    const b = builtinBackend(async () => host)
    await b.judge("you are stupid", null, [])
    await b.judge("you are so stupid", null, [])
    expect(created).toHaveLength(1)
  })

  it("won't check before the model is downloaded", async () => {
    const b = builtinBackend(async () => directHost(fakeLM({ availability: "downloadable" }).lm))
    await expect(b.judge("you are stupid", null, [])).rejects.toMatchObject({ kind: "no-model" })
  })

  it("turns Chrome's errors into backend errors", async () => {
    const unsupported = Object.assign(new Error("language"), { name: "NotSupportedError" })
    const b = builtinBackend(async () => directHost(fakeLM({ fail: unsupported }).lm))
    await expect(b.judge("hola tonto", null, [])).rejects.toMatchObject({ kind: "unsupported" })

    const ctrl = new AbortController()
    ctrl.abort()
    const c = builtinBackend(async () => directHost(fakeLM({ reply: RED }).lm))
    await expect(c.judge("you are stupid", null, [], { signal: ctrl.signal })).rejects.toMatchObject({ kind: "aborted" })
  })

  it("never needs a long first-check timeout (Chrome keeps the model ready)", async () => {
    expect(await builtinBackend(async () => directHost(fakeLM().lm)).isCold()).toBe(false)
  })
})
