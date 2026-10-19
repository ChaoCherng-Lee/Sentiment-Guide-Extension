import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Client = typeof import("../../src/backend/supabase")

/** Load the client with (or without) build-time Supabase settings. */
async function load(configured: boolean): Promise<Client> {
  vi.resetModules()
  vi.stubEnv("WXT_SUPABASE_URL", configured ? "https://proj.supabase.co" : "")
  vi.stubEnv("WXT_SUPABASE_ANON_KEY", configured ? "anon-key" : "")
  return import("../../src/backend/supabase")
}

const EVENT = {
  id: "e1", contact_hash: null, tone: "yellow" as const, confidence: 0.8,
  label: "x", flagged_phrase: "x", suggestion: "x", tone_tags_detected: false,
}

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
    await sb.logEvent(EVENT)
    expect(calls).toEqual([])
  })

  it("uploads nothing before pairing", async () => {
    const sb = await load(true)
    await sb.logEvent(EVENT)
    await sb.logAcceptance("e1", true)
    expect(calls).toEqual([])
  })

  it("pairs with an anonymous session, then uploads with it", async () => {
    const sb = await load(true)
    expect(await sb.pairWithCode("12345")).toBe("invalid")   // not 6 digits: never sent
    expect(calls).toEqual([])

    expect(await sb.pairWithCode("123456")).toBe("ok")
    expect(calls.map(c => new URL(c.url).pathname)).toEqual(["/auth/v1/signup", "/rest/v1/rpc/redeem_pairing_code"])
    expect(await sb.isPaired()).toBe(true)

    await sb.logEvent(EVENT)
    const upload = calls.at(-1)!
    expect(upload.url).toBe("https://proj.supabase.co/rest/v1/events")
    expect((upload.init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
    expect(JSON.parse(upload.init.body as string)).not.toHaveProperty("child_id")   // the database fills it in
  })
})
