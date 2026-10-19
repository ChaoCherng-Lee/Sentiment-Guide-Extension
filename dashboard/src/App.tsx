// Parent dashboard: sign in, link a child with a pairing code, and see a
// weekly summary. There is no message text anywhere — the database doesn't
// have any (Plan 5.2), and this page only ever asks for counts.

import type { Session } from "@supabase/supabase-js"
import { useEffect, useMemo, useState } from "react"
import { BarList, TrendChart, WeeklyChart } from "./components/charts"
import { demoEvents } from "./demo"
import { breakdown, highlights, type SharedEvent, weekly } from "./stats"
import { supabase } from "./supabase"

const WEEKS = 12
const EVENT_FIELDS = "tone, category, confidence, suggestion_accepted, platform, created_at"
const DEMO = new URLSearchParams(location.search).has("demo")

interface Child { child_id: string; created_at: string }

export function App() {
  if (DEMO) return <Page><Summary events={demoEvents()} demo /></Page>
  if (!supabase) {
    return (
      <Page>
        <div className="card">
          <h2>Not set up yet</h2>
          <p className="secondary">This site was built without a Supabase project. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>) and build again — or open <a href="?demo">the demo</a>.</p>
        </div>
      </Page>
    )
  }
  return <SignedInApp />
}

function Page({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <main>
      <header className="top">
        <h1>Sentiment Guide <span className="muted">for parents</span></h1>
        {onSignOut && <button className="link" onClick={onSignOut}>Sign out</button>}
      </header>
      {children}
    </main>
  )
}

function SignedInApp() {
  const sb = supabase!
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [sb])

  if (!ready) return <Page><p className="muted">Loading…</p></Page>
  if (!session) return <Page><SignIn /></Page>
  return <Page onSignOut={() => sb.auth.signOut()}><Children /></Page>
}

// ── Sign in ─────────────────────────────────────────────────────────────────

function SignIn() {
  const sb = supabase!
  const [mode, setMode] = useState<"in" | "up">("in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage("")
    const { data, error } = mode === "in"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password })
    setBusy(false)
    if (error) setMessage(error.message)
    else if (mode === "up" && !data.session) setMessage("Check your email to confirm your account, then sign in.")
  }

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
      <h2>{mode === "in" ? "Sign in" : "Create a parent account"}</h2>
      <p className="sub">See how your child is doing with Sentiment Guide — counts only, never their messages.</p>
      <label className="field">Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
      <label className="field">Password<input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
      {message && <p className="error" role="alert">{message}</p>}
      <button className="primary" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>{" "}
      <button type="button" className="link" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </form>
  )
}

// ── Linked children ─────────────────────────────────────────────────────────

function Children() {
  const sb = supabase!
  const [children, setChildren] = useState<Child[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = async () => {
    const { data, error } = await sb.from("links").select("child_id, created_at").order("created_at")
    if (error) { setError(error.message); return }
    setChildren(data)
    setSelected(s => (s && data.some(c => c.child_id === s) ? s : data[0]?.child_id ?? null))
  }
  useEffect(() => { load() }, [])

  const unlink = async (childId: string) => {
    if (!confirm("Stop seeing this child's summary? They can link again with a new code.")) return
    const { error } = await sb.from("links").delete().eq("child_id", childId)
    if (error) setError(error.message)
    load()
  }

  if (error) return <p className="error" role="alert">{error}</p>
  if (!children) return <p className="muted">Loading…</p>

  return (
    <>
      {children.length > 1 && (
        <div className="children" role="group" aria-label="Child">
          {children.map((c, i) => (
            <button key={c.child_id} aria-pressed={c.child_id === selected} onClick={() => setSelected(c.child_id)}>
              Child {i + 1} <span className="muted">· linked {new Date(c.created_at).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
      )}
      {selected ? <ChildSummary childId={selected} onUnlink={() => unlink(selected)} /> : (
        <div className="card empty">
          <h2>No child linked yet</h2>
          <p>Get a code below and enter it on your child's computer.</p>
        </div>
      )}
      <PairingCard onLinked={load} />
    </>
  )
}

function ChildSummary({ childId, onUnlink }: { childId: string; onUnlink: () => void }) {
  const sb = supabase!
  const [events, setEvents] = useState<SharedEvent[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    setEvents(null)
    const since = new Date(Date.now() - WEEKS * 7 * 86_400_000).toISOString()
    sb.from("events").select(EVENT_FIELDS).eq("child_id", childId).gte("created_at", since)
      .then(({ data, error }) => { if (error) setError(error.message); else setEvents(data as SharedEvent[]) })
  }, [sb, childId])

  if (error) return <p className="error" role="alert">{error}</p>
  if (!events) return <p className="muted">Loading…</p>
  return (
    <>
      <Summary events={events} />
      <p><button className="link danger" onClick={onUnlink}>Stop seeing this child's summary</button></p>
    </>
  )
}

// ── Pairing code ────────────────────────────────────────────────────────────

function PairingCard({ onLinked }: { onLinked: () => void }) {
  const sb = supabase!
  const [code, setCode] = useState<{ code: string; expires: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState("")

  useEffect(() => {
    if (!code) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [code])

  const getCode = async () => {
    setError("")
    const { data, error } = await sb.rpc("create_pairing_code")
    if (error) { setError(error.message); return }
    setCode({ code: data as string, expires: Date.now() + 15 * 60_000 })
    setNow(Date.now())
  }

  const left = code ? Math.max(0, code.expires - now) : 0
  const mins = Math.floor(left / 60_000)
  const secs = Math.floor((left % 60_000) / 1000)

  return (
    <div className="card">
      <h2>Link a child</h2>
      <p className="sub">On your child's computer, open the Sentiment Guide menu → <strong>Sites…</strong> → <strong>Share with a parent</strong>. They'll see exactly what you will and won't see, and choose whether to share. Then they type this code.</p>
      {code && left > 0 ? (
        <>
          <div className="code" aria-live="polite">{code.code}</div>
          <p className="muted">Works once · expires in {mins}:{String(secs).padStart(2, "0")}</p>
          <button onClick={onLinked}>They've entered it — refresh</button>
        </>
      ) : (
        <button className="primary" onClick={getCode}>{code ? "Get a new code" : "Get a pairing code"}</button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

// ── The summary itself ──────────────────────────────────────────────────────

function Summary({ events, demo = false }: { events: SharedEvent[]; demo?: boolean }) {
  const weeks = useMemo(() => weekly(events, new Date(), WEEKS), [events])
  const notes = useMemo(() => highlights(weeks), [weeks])
  const thisWeek = weeks.at(-1)!
  const lastWeek = weeks.at(-2)!
  const fourWeeks = useMemo(() => {
    const since = weeks.at(-4)!.start.getTime()
    return events.filter(e => new Date(e.created_at).getTime() >= since)
  }, [events, weeks])
  const diff = thisWeek.total - lastWeek.total

  return (
    <>
      {demo && <div className="banner">Demo data — made up to show what the dashboard looks like. No real child.</div>}

      <section className="card" aria-labelledby="week-h">
        <h2 id="week-h">This week</h2>
        <ul className="highlights">
          {notes.map(n => (
            <li key={n.text} className={n.kind}>
              <span className="icon" aria-hidden="true">{n.kind === "good" ? "✓" : n.kind === "watch" ? "!" : "•"}</span>
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
        <div className="tiles">
          <div className="tile">
            <div className="label">Suggestions taken</div>
            <div className="value">{thisWeek.total ? `${thisWeek.accepted} of ${thisWeek.total}` : "—"}</div>
            <div className="delta">{thisWeek.acceptRate === null ? "Nothing flagged" : `${Math.round(thisWeek.acceptRate * 100)}% of flagged messages`}</div>
          </div>
          <div className="tile">
            <div className="label">Messages flagged</div>
            <div className="value">{thisWeek.total}</div>
            <div className={`delta${diff < 0 ? " good" : ""}`}>
              {diff === 0 ? "Same as last week" : diff < 0 ? `▼ ${-diff} fewer than last week` : `▲ ${diff} more than last week`}
            </div>
          </div>
          <div className="tile">
            <div className="label">Of those, red (unkind)</div>
            <div className="value">{thisWeek.red}</div>
            <div className="delta">{thisWeek.yellow} yellow</div>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="weekly-h">
        <h2 id="weekly-h">Flagged messages per week</h2>
        <p className="sub">Last {WEEKS} weeks. Yellow: could come across badly. Red: unkind.</p>
        <WeeklyChart weeks={weeks} />
      </section>

      <section className="card" aria-labelledby="trend-h">
        <h2 id="trend-h">Suggestions taken</h2>
        <p className="sub">Share of flagged messages where a kinder version was used, per week.</p>
        <TrendChart weeks={weeks} />
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="apps-h">
          <h2 id="apps-h">By app</h2>
          <p className="sub">Flagged messages, last 4 weeks.</p>
          <BarList items={breakdown(fourWeeks, "platform")} noun="flagged" />
        </section>
        <section className="card" aria-labelledby="kinds-h">
          <h2 id="kinds-h">What kind</h2>
          <p className="sub">Flagged messages, last 4 weeks.</p>
          <BarList items={breakdown(fourWeeks, "category")} noun="flagged" />
        </section>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        You never see your child's messages, who they talk to, or what others send them — only these counts.
        Data older than 90 days is deleted automatically.
      </p>
    </>
  )
}
