// @vitest-environment node
// The database rules (Plan 5.1/5.2), tested against the real migrations in
// PGlite — Postgres compiled to WebAssembly — with a stand-in for Supabase's
// auth schema (supabase-stub.sql).
import { PGlite } from "@electric-sql/pglite"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

const MIGRATIONS = path.resolve("supabase/migrations")
const STUB = readFileSync(path.resolve("test/db/supabase-stub.sql"), "utf8")

const PARENT  = "00000000-0000-4000-8000-000000000001"
const CHILD   = "00000000-0000-4000-8000-000000000002"
const STRANGER = "00000000-0000-4000-8000-000000000003"
const OTHER_CHILD = "00000000-0000-4000-8000-000000000004"

let db: PGlite

/** Run `sql` as a signed-in user (or signed out, with null), like a request with that JWT. */
async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const anonymous = user === CHILD || user === OTHER_CHILD || user === STRANGER
  const claims = user ? JSON.stringify({ sub: user, role: "authenticated", is_anonymous: anonymous }) : ""
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims])
  await db.exec(`set role ${user ? "authenticated" : "anon"}`)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec("reset role")
  }
}

const event = (id: number, child = CHILD) => ({
  id: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  child,
})

async function insertEvent(user: string, id: number, child = user) {
  const e = event(id, child)
  return as(user, `insert into events (id, child_id, tone, confidence, category, platform) values ($1, $2, 'yellow', 0.8, 'insult', 'whatsapp') returning id`, [e.id, e.child])
}

async function pair(parent = PARENT, child = CHILD) {
  const [{ code }] = await as<{ code: string }>(parent, "select create_pairing_code() as code")
  const [{ result }] = await as<{ result: string }>(child, "select redeem_pairing_code($1) as result", [code])
  return result
}

// A fresh database per test: starting Postgres and running every migration
// takes a few seconds, longer while other test files run alongside
beforeEach(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(STUB)
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"))
  }
  await db.query(`insert into auth.users (id, email, is_anonymous) values
    ($1, 'parent@example.com', false), ($2, null, true), ($3, null, true), ($4, null, true)`,
  [PARENT, CHILD, STRANGER, OTHER_CHILD])
}, 60_000)

describe("events", () => {
  it("can't be read or written when signed out", async () => {
    await expect(as(null, "select * from events")).rejects.toThrow(/permission denied/)
    await expect(as(null, `insert into events (id, child_id, tone) values ($1, $2, 'red')`, [event(1).id, CHILD]))
      .rejects.toThrow(/permission denied/)
  })

  it("a child inserts only their own, and child_id defaults to them", async () => {
    await insertEvent(CHILD, 1)
    await expect(insertEvent(CHILD, 2, OTHER_CHILD)).rejects.toThrow(/row-level security/)
    await as(CHILD, `insert into events (id, tone) values ($1, 'red')`, [event(3).id])
    expect(await as(CHILD, "select child_id from events where id = $1", [event(3).id])).toEqual([{ child_id: CHILD }])
  })

  it("a parent reads a child's events only once linked, and can't change them", async () => {
    await insertEvent(CHILD, 1)
    expect(await as(PARENT, "select id from events")).toEqual([])
    expect(await pair()).toBe("ok")
    expect(await as(PARENT, "select id from events")).toHaveLength(1)

    expect(await as(PARENT, "update events set suggestion_accepted = true returning id")).toEqual([])
    expect(await as(PARENT, "delete from events returning id")).toEqual([])
    await expect(as(PARENT, `insert into events (id, child_id, tone) values ($1, $2, 'red')`, [event(9).id, CHILD]))
      .rejects.toThrow(/row-level security/)
  })

  it("other users never see a child's events", async () => {
    await insertEvent(CHILD, 1)
    await pair()
    expect(await as(STRANGER, "select id from events")).toEqual([])
    expect(await as(OTHER_CHILD, "select id from events")).toEqual([])
  })

  it("only the child can update or delete their events", async () => {
    await insertEvent(CHILD, 1)
    expect(await as(OTHER_CHILD, "update events set suggestion_accepted = true returning id")).toEqual([])
    expect(await as(CHILD, "update events set suggestion_accepted = true returning id")).toHaveLength(1)
    await expect(as(CHILD, "update events set child_id = $1", [OTHER_CHILD])).rejects.toThrow(/row-level security/)
    expect(await as(CHILD, "delete from events returning id")).toHaveLength(1)
  })
})

describe("pairing", () => {
  it("only a parent signed in with email can make a code: 6 digits, a new one replacing the old", async () => {
    await expect(as(CHILD, "select create_pairing_code()")).rejects.toThrow(/signed in with email/)
    const [{ code: first }]  = await as<{ code: string }>(PARENT, "select create_pairing_code() as code")
    const [{ code: second }] = await as<{ code: string }>(PARENT, "select create_pairing_code() as code")
    expect(first).toMatch(/^\d{6}$/)
    // The first code stopped working when the second was made
    const [{ result }] = await as<{ result: string }>(CHILD, "select redeem_pairing_code($1) as result", [first])
    if (first !== second) expect(result).toBe("invalid")
  })

  it("a code works once", async () => {
    const [{ code }] = await as<{ code: string }>(PARENT, "select create_pairing_code() as code")
    expect((await as<{ r: string }>(CHILD, "select redeem_pairing_code($1) as r", [code]))[0].r).toBe("ok")
    expect((await as<{ r: string }>(OTHER_CHILD, "select redeem_pairing_code($1) as r", [code]))[0].r).toBe("invalid")
  })

  it("an expired code doesn't work", async () => {
    const [{ code }] = await as<{ code: string }>(PARENT, "select create_pairing_code() as code")
    await db.query("update pairing_codes set expires_at = now() - interval '1 minute'")
    expect((await as<{ r: string }>(CHILD, "select redeem_pairing_code($1) as r", [code]))[0].r).toBe("invalid")
  })

  it("5 wrong tries in an hour lock pairing, even with the right code", async () => {
    const [{ code }] = await as<{ code: string }>(PARENT, "select create_pairing_code() as code")
    const wrong = code === "000000" ? "000001" : "000000"
    for (let i = 0; i < 5; i++) {
      expect((await as<{ r: string }>(CHILD, "select redeem_pairing_code($1) as r", [wrong]))[0].r).toBe("invalid")
    }
    expect((await as<{ r: string }>(CHILD, "select redeem_pairing_code($1) as r", [code]))[0].r).toBe("too_many")
  })

  it("codes and attempts can't be read directly", async () => {
    await as(PARENT, "select create_pairing_code()")
    await expect(as(PARENT, "select * from pairing_codes")).rejects.toThrow(/permission denied/)
    await expect(as(CHILD, "select * from pairing_attempts")).rejects.toThrow(/permission denied/)
  })

  it("both sides see their link, others don't, and links can't be made by hand", async () => {
    await pair()
    expect(await as(PARENT, "select child_id from links")).toEqual([{ child_id: CHILD }])
    expect(await as(CHILD, "select parent_id from links")).toEqual([{ parent_id: PARENT }])
    expect(await as(STRANGER, "select * from links")).toEqual([])
    await expect(as(STRANGER, "insert into links (parent_id, child_id) values ($1, $2)", [STRANGER, CHILD]))
      .rejects.toThrow(/row-level security|permission denied/)
  })

  it("unlinking stops the parent seeing anything", async () => {
    await insertEvent(CHILD, 1)
    await pair()
    expect(await as(CHILD, "delete from links returning parent_id")).toHaveLength(1)
    expect(await as(PARENT, "select id from events")).toEqual([])
  })
})

describe("data minimisation (5.2)", () => {
  it("events hold no text: only tone, category, confidence, accepted, platform and time", async () => {
    const cols = (await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'events' order by column_name",
    )).rows.map(r => r.column_name)
    expect(cols).toEqual(["category", "child_id", "confidence", "created_at", "id", "platform", "suggestion_accepted", "tone"])
  })

  it("only known categories and platforms are accepted", async () => {
    await expect(as(CHILD, `insert into events (id, tone, category) values ($1, 'red', 'called Sam a loser')`, [event(1).id]))
      .rejects.toThrow(/check constraint/)
    await expect(as(CHILD, `insert into events (id, tone, platform) values ($1, 'red', 'facebook')`, [event(2).id]))
      .rejects.toThrow(/check constraint/)
  })

  it("flags from other websites are shared as 'web', without saying which site", async () => {
    await as(CHILD, `insert into events (id, tone, platform) values ($1, 'red', 'web')`, [event(3).id])
    await expect(as(CHILD, `insert into events (id, tone, platform) values ($1, 'red', 'reddit.com')`, [event(4).id]))
      .rejects.toThrow(/check constraint/)
  })

  it("per-contact context answers aren't kept at all", async () => {
    const t = await db.query("select 1 from information_schema.tables where table_schema = 'public' and table_name = 'context_forms'")
    expect(t.rows).toEqual([])
  })

  it("'Unlink and delete my data' removes the child's events and links, and nobody else's", async () => {
    await insertEvent(CHILD, 1)
    await insertEvent(OTHER_CHILD, 2)
    await pair()
    await pair(PARENT, OTHER_CHILD)
    await as(CHILD, "select delete_my_data()")
    expect(await as(CHILD, "select id from events")).toEqual([])
    expect(await as(CHILD, "select * from links")).toEqual([])
    expect(await as(PARENT, "select child_id from links")).toEqual([{ child_id: OTHER_CHILD }])
    expect(await as(PARENT, "select id from events")).toHaveLength(1)
  })

  it("events older than 90 days are purged, and only the system can run the purge", async () => {
    await insertEvent(CHILD, 1)
    await insertEvent(CHILD, 2)
    await db.query("update events set created_at = now() - interval '91 days' where id = $1", [event(1).id])
    await expect(as(CHILD, "select purge_old_events()")).rejects.toThrow(/permission denied/)
    expect((await db.query<{ n: number }>("select purge_old_events() as n")).rows[0].n).toBe(1)
    expect((await db.query("select id from events")).rows).toEqual([{ id: event(2).id }])
  })
})

describe("cloud check rate limit (8.3)", () => {
  async function asService<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await db.exec("set role service_role")
    try {
      return (await db.query<T>(sql, params)).rows
    } finally {
      await db.exec("reset role")
    }
  }

  it("counts hits per key per hour and says no once over the limit", async () => {
    const hit = async (key: string) => (await asService<{ ok: boolean }>("select cloud_rate_hit($1, 2) as ok", [key]))[0].ok
    expect(await hit("t:a")).toBe(true)
    expect(await hit("t:a")).toBe(true)
    expect(await hit("t:a")).toBe(false)
    expect(await hit("t:b")).toBe(true)
  })

  it("is out of reach for the extension's own keys", async () => {
    await expect(as(null, "select cloud_rate_hit('t:a', 1000)")).rejects.toThrow(/permission denied/)
    await expect(as(CHILD, "select cloud_rate_hit('t:a', 1000)")).rejects.toThrow(/permission denied/)
    await expect(as(null, "select * from cloud_rate")).rejects.toThrow(/permission denied/)
  })
})

// Plan 12.2: opt-in diagnostics — anyone can add a day of counts, nobody can read them back
describe("diagnostics", () => {
  const add = (user: string | null, counts: unknown, day = "now()::date") =>
    as(user, `insert into diagnostics (day, edition, version, counts) values (${day}, 'consumer', '1.1.0', $1::jsonb)`, [JSON.stringify(counts)])

  it("anyone can add counts, signed in or not, but not read them", async () => {
    await add(null, { "check.cloud": 12, "flag.red.chat": 1 })
    await add(CHILD, { accepted: 2 })
    await expect(as(null, "select * from diagnostics")).rejects.toThrow(/permission denied/)
    await expect(as(CHILD, "select * from diagnostics")).rejects.toThrow(/permission denied/)
    await expect(as(null, "delete from diagnostics")).rejects.toThrow(/permission denied/)
    expect((await db.query("select count(*)::int as n from diagnostics")).rows).toEqual([{ n: 2 }])
  })

  it("takes only short count names and whole numbers, never text", async () => {
    await expect(add(null, { "check.cloud": "you are so stupid" })).rejects.toThrow(/diagnostics_counts_valid/)
    await expect(add(null, { "you are so stupid": 1 })).rejects.toThrow(/diagnostics_counts_valid/)
    await expect(add(null, { "check.cloud": 1.5 })).rejects.toThrow(/diagnostics_counts_valid/)
    await expect(add(null, ["check.cloud"])).rejects.toThrow(/diagnostics_counts_valid/)
    await expect(add(null, { "check.cloud": 1 }, "'2020-01-01'")).rejects.toThrow(/diagnostics_day_recent/)
  })
})
