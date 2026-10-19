import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Client = typeof import("../../src/backend/supabase")

/** Load the client with (or without) build-time Supabase settings. */
async function load(configured: boolean): Promise<Client> {
  vi.resetModules()
  vi.stubEnv("WXT_SUPABASE_URL", configured ? "https://proj.supabase.co" : "")
  vi.stubEnv("WXT_SUPABASE_ANON_KEY", configured ? "anon-key" : "")
  return import("../../src/backend/supabase")
}

const EVENT = { id: "e1", tone: "yellow" as const, category: "insult" as const, confidence: 0.8, platform: "whatsapp" as const }

let calls: { url: string; init: RequestInit }[]

beforeEach(() => {
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url.includes("/auth/v1/signup")) {
      return new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600, user: { id: "child-1" } }))
    }
    if (url.includes("/rpc/redeem_pairing_code")) return new Response(JSON.stringify("ok"))
    return new Response(null, { status: 201 })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("supabase client", () => {
  it("does nothing at all without build-time settings", async () => {
    const sb = await load(false)
    expect(sb.supabaseConfigured()).toBe(false)
    expect(await sb.pairWithCode("123456")).toBe("not_configured")
    await sb.logEvent(EVENT, true)
    expect(calls).toEqual([])
  })

  it("uploads nothing before pairing", async () => {
    const sb = await load(true)
    await sb.logEvent(EVENT, true)
    await sb.logAcceptance("e1", true, true)
    expect(calls).toEqual([])
  })

  it("pairs with an anonymous session, then uploads with it", async () => {
    const sb = await load(true)
    expect(await sb.pairWithCode("12345")).toBe("invalid")   // not 6 digits: never sent
    expect(calls).toEqual([])

    expect(await sb.pairWithCode("123456")).toBe("ok")
    expect(calls.map(c => new URL(c.url).pathname)).toEqual(["/auth/v1/signup", "/rest/v1/rpc/redeem_pairing_code"])
    expect(await sb.isPaired()).toBe(true)

    await sb.logEvent(EVENT, true)
    const upload = calls.at(-1)!
    expect(upload.url).toBe("https://proj.supabase.co/rest/v1/events?on_conflict=id")
    expect((upload.init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
    // Only these fields — the database fills in child_id
    expect(Object.keys(JSON.parse(upload.init.body as string)).sort())
      .toEqual(["category", "confidence", "created_at", "id", "platform", "suggestion_accepted", "tone"])
  })

  it("queues uploads while paused or offline, and sends them in order later", async () => {
    const sb = await load(true)
    await sb.pairWithCode("123456")
    calls = []
    await sb.logEvent(EVENT, false)                 // paused: kept, not sent
    await sb.logAcceptance("e1", true, false)       // merged into the waiting event
    expect(calls).toEqual([])

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    await sb.flushUploads(true)                     // offline: still kept

    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(null, { status: 201 })
    }))
    await sb.flushUploads(true)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ id: "e1", suggestion_accepted: true })
    await sb.flushUploads(true)
    expect(calls).toHaveLength(1)                   // nothing left to send
  })

  it("'Unlink and delete my data' deletes on the server, then forgets the account", async () => {
    const sb = await load(true)
    await sb.pairWithCode("123456")
    expect(await sb.unlinkAndDelete()).toBe(true)
    expect(new URL(calls.at(-1)!.url).pathname).toBe("/rest/v1/rpc/delete_my_data")
    expect(await sb.isPaired()).toBe(false)
  })
})
