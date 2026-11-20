import { describe, expect, it, vi } from "vitest"
import { cloudBackend, type TokenStore } from "../../src/analysis/cloud"

const URL_ = "https://p.supabase.co/functions/v1/tone-check"
const RED = { tone: "red", confidence: 0.9, flagged_phrase: "stupid" }

function memoryTokens(start: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: start,
    get: async () => store.value,
    set: async (t: string | null) => { store.value = t },
  }
  return store
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

function backend(handler: Handler, tokens = memoryTokens()) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body as string) : {} })
    return handler(url, init)
  }) as unknown as typeof fetch
  return { b: cloudBackend({ url: URL_, anonKey: "anon", tokens, fetchImpl }), calls, tokens }
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe("cloud backend", () => {
  it("isn't on this computer, so it never gets chat context", async () => {
    const { b, calls } = backend((url) => url.endsWith("/register") ? ok({ token: "id.sig" }) : ok({ result: RED }))
    expect(b.local).toBe(false)
    await b.judge("you are stupid", null, [{ from: "them", text: "a secret" }])
    expect(JSON.stringify(calls)).not.toContain("a secret")
  })

  it("registers once, then sends its token with every check", async () => {
    const { b, calls, tokens } = backend((url) => url.endsWith("/register") ? ok({ token: "id.sig" }) : ok({ result: RED }))
    const v = await b.judge("you are stupid", null, [])
    await b.judge("you are so stupid", null, [])
    expect(v).toMatchObject({ tone: "red", flagged_phrase: "stupid" })
    expect(calls.filter(c => c.url.endsWith("/register"))).toHaveLength(1)
    expect(tokens.value).toBe("id.sig")
    const check = calls.at(-1)!
    expect((check.init.headers as Record<string, string>)["x-install-token"]).toBe("id.sig")
    expect(check.body).toMatchObject({ task: "verdict", text: "you are so stupid" })
  })

  it("sends only the context answers, not anything else about the chat", async () => {
    const { b, calls } = backend(() => ok({ result: RED }), memoryTokens("id.sig"))
    await b.judge("you are stupid", { platform: "whatsapp", q1: "close_friend", q2: "casual", q3: "no", q4: "no", q5: "normal", savedAt: 123 }, [])
    expect(calls[0].body.context).toEqual({ q1: "close_friend", q2: "casual", q3: "no", q4: "no", q5: "normal" })
  })

  it("gets a new token once if the server stops accepting the old one", async () => {
    let first = true
    const { b, tokens } = backend((url) => {
      if (url.endsWith("/register")) return ok({ token: "new.sig" })
      if (first) { first = false; return ok({ error: "bad token" }, 401) }
      return ok({ result: RED })
    }, memoryTokens("old.sig"))
    await b.judge("you are stupid", null, [])
    expect(tokens.value).toBe("new.sig")
  })

  it("says when the hourly limit is reached, or it can't be reached at all", async () => {
    const limited = backend(() => ok({ error: "hourly limit reached" }, 429), memoryTokens("id.sig"))
    await expect(limited.b.judge("hello", null, [])).rejects.toMatchObject({ kind: "rate-limited" })
    const offline = backend(() => { throw new TypeError("Failed to fetch") }, memoryTokens("id.sig"))
    await expect(offline.b.judge("hello", null, [])).rejects.toMatchObject({ kind: "offline" })
  })

  it("checks the model's answers like any other backend (a nonsense answer flags nothing)", async () => {
    const { b } = backend(() => ok({ result: { tone: "purple", flagged_phrase: "not in the message" } }), memoryTokens("id.sig"))
    expect(await b.judge("hello", null, [])).toMatchObject({ tone: "green", flagged_phrase: "" })
  })

  it("isn't offered in a build without a Supabase project", async () => {
    const b = cloudBackend(null)
    expect(await b.status()).toMatchObject({ state: "unsupported" })
    await expect(b.judge("hello", null, [])).rejects.toMatchObject({ kind: "unsupported" })
  })

  it("reports ready when the function answers, offline when it doesn't", async () => {
    expect((await backend(() => ok({ ok: true })).b.status()).state).toBe("ready")
    expect((await backend(() => { throw new TypeError("x") }).b.status()).state).toBe("offline")
  })
})
