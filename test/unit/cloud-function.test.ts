// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { CHECKS_PER_HOUR, type Deps, handle, MAX_TEXT, newToken, tokenId } from "../../supabase/functions/tone-check/handler"
import { anthropic } from "../../supabase/functions/tone-check/providers"
// @ts-expect-error plain JavaScript build script
import { DEST, expected } from "../../scripts/sync-function.mjs"

const SECRET = "x".repeat(40)
const URL_ = "https://p.supabase.co/functions/v1/tone-check"
const RED = { tone: "red", confidence: 0.9, flagged_phrase: "stupid" }

function deps(over: Partial<Deps> = {}) {
  const hits = new Map<string, number>()
  const logs: Record<string, unknown>[] = []
  const calls: { messages: { role: string; content: string }[]; schema: object }[] = []
  const d: Deps = {
    secret: SECRET,
    callModel: async (messages, schema) => { calls.push({ messages, schema }); return RED },
    rateHit: async (key, max) => { hits.set(key, (hits.get(key) ?? 0) + 1); return hits.get(key)! <= max },
    log: line => logs.push(line),
    ...over,
  }
  return { d, hits, logs, calls }
}

const post = (body: unknown, token?: string, path = "") => new Request(URL_ + path, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { "x-install-token": token } : {}), "x-forwarded-for": "203.0.113.9" },
  body: JSON.stringify(body),
})

describe("cloud check function", () => {
  it("hands out install tokens it can recognise, and rejects forged ones", async () => {
    const t = await newToken(SECRET)
    expect(await tokenId(SECRET, t)).toBe(t.split(".")[0])
    expect(await tokenId(SECRET, t.slice(0, -2) + "zz")).toBeNull()
    expect(await tokenId("y".repeat(40), t)).toBeNull()
    expect(await tokenId(SECRET, null)).toBeNull()
  })

  it("registers an install, a limited number of times per address", async () => {
    const { d } = deps({ rateHit: async () => false })
    expect((await handle(post({}, undefined, "/register"), d)).status).toBe(429)
    const ok = deps()
    const res = await handle(post({}, undefined, "/register"), ok.d)
    expect(res.status).toBe(200)
    expect(await tokenId(SECRET, (await res.json()).token)).toBeTruthy()
    // The address is kept only as a one-way hash
    expect([...ok.hits.keys()][0]).not.toContain("203.0.113.9")
  })

  it("checks a message with the extension's own prompt and schema", async () => {
    const { d, calls } = deps()
    const res = await handle(post({ task: "verdict", text: "you are stupid" }, await newToken(SECRET)), d)
    expect(res.status).toBe(200)
    expect((await res.json()).result).toEqual(RED)
    expect(calls[0].messages[0].role).toBe("system")
    expect(calls[0].messages.at(-1)!.content).toContain("you are stupid")
    expect(calls[0].schema).toMatchObject({ properties: { tone: {} } })
  })

  it("never takes chat context: other people's messages stay on the computer", async () => {
    const { d, calls } = deps()
    await handle(post({ task: "verdict", text: "lol ok", recent: [{ from: "them", text: "my secret plans" }] }, await newToken(SECRET)), d)
    expect(JSON.stringify(calls[0].messages)).not.toContain("my secret plans")
  })

  it("writes advice for a flagged message in the chosen style", async () => {
    const { d, calls } = deps()
    const res = await handle(post({ task: "advice", text: "you are stupid", verdict: RED, style: "formal" }, await newToken(SECRET)), d)
    expect(res.status).toBe(200)
    expect(calls[0].messages[0].content).toMatch(/formal/i)
  })

  it("refuses without a genuine token, odd tasks, and overlong text", async () => {
    const { d, calls } = deps()
    const t = await newToken(SECRET)
    expect((await handle(post({ task: "verdict", text: "hi" }), d)).status).toBe(401)
    expect((await handle(post({ task: "verdict", text: "hi" }, "abc.def"), d)).status).toBe(401)
    expect((await handle(post({ task: "write me a poem", text: "hi" }, t), d)).status).toBe(400)
    expect((await handle(post({ task: "verdict", text: "a".repeat(MAX_TEXT + 1) }, t), d)).status).toBe(400)
    expect((await handle(post({ task: "advice", text: "hi" }, t), d)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it("stops at the hourly limit for an install", async () => {
    const { d } = deps()
    const t = await newToken(SECRET)
    let last = 0
    for (let i = 0; i <= CHECKS_PER_HOUR; i++) last = (await handle(post({ task: "verdict", text: "hello" }, t), d)).status
    expect(last).toBe(429)
  })

  it("logs timing and status, never the message or the answer", async () => {
    const { d, logs } = deps({ callModel: async () => { throw new Error("upstream said: you are stupid") } })
    const res = await handle(post({ task: "verdict", text: "you are stupid" }, await newToken(SECRET)), d)
    expect(res.status).toBe(502)
    expect(JSON.stringify(logs)).not.toContain("stupid")
    expect(logs.at(-1)).toMatchObject({ route: "check", task: "verdict", status: 502 })
  })

  it("answers a health check", async () => {
    expect((await handle(new Request(URL_), deps().d)).status).toBe(200)
  })
})

describe("anthropic provider", () => {
  it("forces a tool whose input schema is ours and returns its input", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.tool_choice).toEqual({ type: "tool", name: "answer" })
      expect(body.tools[0].input_schema).toEqual({ type: "object" })
      expect(body.system).toBe("sys")
      expect(body.messages).toEqual([{ role: "user", content: "msg" }])
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "answer", input: RED }] }))
    })
    const call = anthropic("key", "claude-haiku-5-5", fetchImpl as unknown as typeof fetch)
    const out = await call([{ role: "system", content: "sys" }, { role: "user", content: "msg" }], { type: "object" }, new AbortController().signal)
    expect(out).toEqual(RED)
  })
})

describe("shared prompt code", () => {
  it("the function's copy matches src/analysis (run npm run sync:function)", () => {
    for (const { file, text } of expected() as { file: string; text: string }[]) {
      const copy = readFileSync(path.join(DEST, file), "utf8").replace(/\r\n/g, "\n")
      expect(copy, file).toBe(text)
    }
  })
})
