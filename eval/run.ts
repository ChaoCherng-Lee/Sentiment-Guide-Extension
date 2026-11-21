// =============================================================================
// Tone evaluation — runs every labelled message in eval/messages.jsonl
// through the real prompt on a backend (Ollama by default) and reports how
// well it does against the Spec targets.
//
//   npm run eval                          # whole set
//   npm run eval -- --category emoji      # one category (or several: emoji,slang)
//   npm run eval -- --limit 20 --model gemma3:4b
//   npm run eval -- --backend cloud        # see eval/backends.ts
//   npm run eval -- --advice              # also time step 2 on flagged messages
//   npm run eval -- --advice --style formal
//   npm run eval -- --category context --no-recent   # same cases without the chat
//   npm run eval -- --sensitivity gentle  # gentle | balanced (default) | strict
//   npm run eval -- --no-language-check   # also judge languages the backend isn't approved for
//   npm run eval -- --compare             # also show the change from the last saved run
//   npm run eval -- --check               # exit 1 if a Spec target (NFR-1) is missed
//
// Cases with "recent" carry the last few chat messages (chat context, 2.3).
// The "context" category has pairs: the same message after a joking thread
// and after an argument, which should come out differently.
//
// Accuracy comes from step 1 (the verdict), which decides what gets flagged.
// Messages the language check skips (Plan 9.2) are listed as "not checked"
// and left out of the accuracy numbers, as in the extension.
//
// Run it before and after every prompt change and put the summary line in
// the commit message. Results are also written to eval/results/.
//
// The expected labels are a team judgement call, not ground truth — review
// and correct them in messages.jsonl as you go.
// =============================================================================

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { evalBackend } from "./backends"
import { unsupportedLanguage } from "../src/analysis/language"
import { type ChatContext, type ChatMessage, type Sensitivity, SENSITIVITIES, type SuggestionStyle, type Tone, type ToneVerdict } from "../src/analysis/types"

interface Case {
  id: number
  category: string
  text: string
  expected: Tone
  context?: Partial<ChatContext>
  /** Chat messages before this one, oldest first */
  recent?: ChatMessage[]
  /** For context cases: what the recent messages are like ("joking", "tense") */
  thread?: string
}

interface Outcome {
  case: Case
  result: ToneVerdict | null
  error?: string
  /** Not checked: the language check skipped it (the language code) */
  skipped?: string
  /** Step 1 time */
  ms: number
  /** Step 2 time, with --advice, for flagged messages */
  adviceMs?: number
  suggestion?: string
}

const TONES: Tone[] = ["green", "yellow", "red"]
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))

const { values: args } = parseArgs({
  options: {
    category: { type: "string" },
    limit:    { type: "string" },
    model:    { type: "string" },
    backend:  { type: "string", default: "ollama" },
    file:     { type: "string", default: path.join(DIR, "messages.jsonl") },
    advice:   { type: "boolean", default: false },
    style:    { type: "string", default: "casual" },
    sensitivity: { type: "string", default: "balanced" },
    "no-recent": { type: "boolean", default: false },
    "no-language-check": { type: "boolean", default: false },
    compare:  { type: "boolean", default: false },
    check:    { type: "boolean", default: false },
  },
})

// ---------------------------------------------------------------------------
// Spec targets (Spec.md NFR-1 accuracy, NFR-2 speed). "Fine" = expected green;
// "hurtful" = expected yellow or red.
// ---------------------------------------------------------------------------

export interface Metrics {
  n: number
  exact: number
  /** Fine messages that came out red */
  falseRed: number
  /** Fine messages that came out yellow or red */
  anyFlagOnFine: number
  /** Hurtful messages flagged (yellow or red) */
  caught: number
  p50Ms: number
  p95Ms: number
}

interface Target { key: keyof Metrics; label: string; max?: number; min?: number; unit: "%" | "ms" }

const TARGETS: Target[] = [
  { key: "falseRed",      label: "false red on fine",  max: 0.02, unit: "%" },
  { key: "anyFlagOnFine", label: "any flag on fine",   max: 0.08, unit: "%" },
  { key: "caught",        label: "hurtful caught",     min: 0.90, unit: "%" },
  { key: "p50Ms",         label: "verdict p50",        max: 700,  unit: "ms" },
  { key: "p95Ms",         label: "verdict p95",        max: 1500, unit: "ms" },
]

const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d)

function quantile(values: number[], q: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/** Works on fresh outcomes and on ones read back from eval/results. */
export function metrics(outcomes: Pick<Outcome, "case" | "result" | "ms">[]): Metrics {
  const done = outcomes.filter(o => o.result)
  const fine = done.filter(o => o.case.expected === "green")
  const hurtful = done.filter(o => o.case.expected !== "green")
  return {
    n: done.length,
    exact: ratio(done.filter(o => o.result!.tone === o.case.expected).length, done.length),
    falseRed: ratio(fine.filter(o => o.result!.tone === "red").length, fine.length),
    anyFlagOnFine: ratio(fine.filter(o => o.result!.tone !== "green").length, fine.length),
    caught: ratio(hurtful.filter(o => o.result!.tone !== "green").length, hurtful.length),
    p50Ms: quantile(done.map(o => o.ms), 0.5),
    p95Ms: quantile(done.map(o => o.ms), 0.95),
  }
}

const show = (t: Target, v: number) =>
  t.unit === "%" ? `${(100 * v).toFixed(1)}%` : `${(v / 1000).toFixed(2)} s`

function meets(t: Target, v: number) {
  return (t.max === undefined || v <= t.max) && (t.min === undefined || v >= t.min)
}

/** Prints the Spec table; returns the targets missed. */
function reportTargets(now: Metrics, before: { metrics: Metrics, file: string } | null, slowModel: boolean) {
  console.log("\nSpec targets" + (before ? `   (vs ${before.file})` : ""))
  const missed: string[] = []
  for (const t of TARGETS) {
    const v = now[t.key]
    const speed = t.unit === "ms"
    const ok = meets(t, v)
    const goal = t.max !== undefined ? `≤ ${show(t, t.max)}` : `≥ ${show(t, t.min!)}`
    // Speed is best effort on a local Ollama model (Spec NFR-2)
    const mark = ok ? "✓" : speed && slowModel ? "–" : "✗"
    if (!ok && !(speed && slowModel)) missed.push(t.label)
    let diff = ""
    if (before) {
      const d = v - before.metrics[t.key]
      diff = t.unit === "%" ? `${d >= 0 ? "+" : ""}${(100 * d).toFixed(1)} pts` : `${d >= 0 ? "+" : ""}${(d / 1000).toFixed(2)} s`
      diff = `  (${diff})`
    }
    console.log(`  ${mark} ${t.label.padEnd(18)} ${show(t, v).padStart(8)}   target ${goal}${diff}`)
  }
  if (slowModel) console.log("  (– speed is best effort on Ollama)")
  return missed
}

/** The newest saved run before this one, with metrics worked out from its outcomes. */
/** The latest saved run over the same cases (same ids), so subsets don't compare with full runs. */
function previousRun(dir: string, cases: Case[]): { metrics: Metrics, file: string } | null {
  if (!existsSync(dir)) return null
  const ids = cases.map(c => c.id).join(",")
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort().reverse()) {
    const saved = JSON.parse(readFileSync(path.join(dir, file), "utf8"))
    if ((saved.outcomes as Outcome[]).map(o => o.case.id).join(",") !== ids) continue
    return { metrics: saved.metrics ?? metrics(saved.outcomes), file }
  }
  return null
}

const recentFor = (c: Case): ChatMessage[] => (args["no-recent"] ? [] : c.recent ?? [])

function loadCases(): Case[] {
  let cases = readFileSync(args.file!, "utf8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Case)
  if (args.category) {
    const wanted = args.category.split(",")
    cases = cases.filter(c => wanted.includes(c.category))
  }
  if (args.limit) cases = cases.slice(0, Number(args.limit))
  return cases
}

function fullContext(ctx: Partial<ChatContext> | undefined): ChatContext | null {
  if (!ctx) return null
  return { platform: "whatsapp", q1: "", q2: "", q3: "no", q4: "not_sure", q5: "normal", savedAt: 0, ...ctx }
}

const pct = (n: number, d: number) => (d === 0 ? "  –  " : `${((100 * n) / d).toFixed(1).padStart(5)}%`)
const flagged = (t: Tone) => t !== "green"

function report(outcomes: Outcome[], model: string) {
  const done = outcomes.filter(o => o.result)
  const predicted = (o: Outcome) => o.result!.tone

  const notChecked = outcomes.filter(o => o.skipped).length
  console.log(`\nModel: ${model} · ${done.length}/${outcomes.length - notChecked} cases answered` +
    (notChecked ? ` · ${notChecked} not checked (language)` : "") + "\n")

  // Confusion matrix
  console.log("expected \\ got   green  yellow    red")
  for (const exp of TONES) {
    const row = TONES.map(got => done.filter(o => o.case.expected === exp && predicted(o) === got).length)
    console.log(`${exp.padEnd(16)}${row.map(n => String(n).padStart(7)).join("")}`)
  }

  // Per-tone precision and recall
  console.log("\ntone      precision  recall")
  for (const t of TONES) {
    const tp = done.filter(o => o.case.expected === t && predicted(o) === t).length
    const fp = done.filter(o => o.case.expected !== t && predicted(o) === t).length
    const fn = done.filter(o => o.case.expected === t && predicted(o) !== t).length
    console.log(`${t.padEnd(10)}${pct(tp, tp + fp).padStart(9)} ${pct(tp, tp + fn).padStart(7)}`)
  }

  // Flag / don't flag — what users actually experience
  const shouldFlag    = done.filter(o => flagged(o.case.expected))
  const shouldntFlag  = done.filter(o => !flagged(o.case.expected))
  const falsePositive = shouldntFlag.filter(o => flagged(predicted(o))).length
  const caught        = shouldFlag.filter(o => flagged(predicted(o))).length
  const exact         = done.filter(o => predicted(o) === o.case.expected).length
  const avgMs         = done.reduce((s, o) => s + o.ms, 0) / Math.max(1, done.length)
  const advised       = done.filter(o => o.adviceMs !== undefined)
  const avgAdviceMs   = advised.reduce((s, o) => s + o.adviceMs!, 0) / Math.max(1, advised.length)

  console.log("\nper category        exact   flag on fine   hurtful caught")
  for (const cat of [...new Set(done.map(o => o.case.category))]) {
    const inCat = done.filter(o => o.case.category === cat)
    const ok = inCat.filter(o => predicted(o) === o.case.expected).length
    const fine = inCat.filter(o => !flagged(o.case.expected))
    const hurt = inCat.filter(o => flagged(o.case.expected))
    const fp = fine.filter(o => flagged(predicted(o))).length
    const tp = hurt.filter(o => flagged(predicted(o))).length
    console.log(`  ${cat.padEnd(18)} ${pct(ok, inCat.length)}   ${pct(fp, fine.length).padStart(8)} ${`(${fp}/${fine.length})`.padStart(7)}   ${pct(tp, hurt.length).padStart(8)} ${`(${tp}/${hurt.length})`.padStart(7)}`)
  }

  // Context pairs: the same message after different threads should get different tones
  const pairs = new Map<string, Outcome[]>()
  for (const o of done.filter(o => o.case.category === "context")) {
    pairs.set(o.case.text, [...(pairs.get(o.case.text) ?? []), o])
  }
  const full = [...pairs.values()].filter(p => p.length === 2)
  if (full.length) {
    const differ = full.filter(([a, b]) => predicted(a) !== predicted(b)).length
    const right  = full.filter(p => p.every(o => predicted(o) === o.case.expected)).length
    console.log(`\ncontext pairs: ${differ}/${full.length} come out differently, ${right}/${full.length} both right` +
      (args["no-recent"] ? " (run without the chat)" : ""))
  }

  const summary =
    `eval: exact ${pct(exact, done.length).trim()}, ` +
    `flag recall ${pct(caught, shouldFlag.length).trim()}, ` +
    `false-positive rate ${pct(falsePositive, shouldntFlag.length).trim()}, ` +
    `verdict avg ${(avgMs / 1000).toFixed(2)} s` +
    (advised.length ? `, advice avg ${(avgAdviceMs / 1000).toFixed(2)} s` : "") +
    ` (${model}, n=${done.length})`
  console.log("\n" + summary)

  const misses = done.filter(o => predicted(o) !== o.case.expected)
  if (misses.length) {
    console.log("\nmisses:")
    for (const o of misses) {
      const thread = o.case.thread ? ` (${o.case.thread} thread)` : ""
      console.log(`  #${o.case.id} [${o.case.category}]${thread} expected ${o.case.expected}, got ${predicted(o)}: ${JSON.stringify(o.case.text)}`)
    }
  }
  const skipped = outcomes.filter(o => o.skipped)
  if (skipped.length) {
    console.log(`\nnot checked (language): ${skipped.length}`)
    for (const o of skipped) console.log(`  #${o.case.id} [${o.case.category}] ${o.skipped}, expected ${o.case.expected}: ${JSON.stringify(o.case.text)}`)
  }
  const errors = outcomes.filter(o => !o.result && !o.skipped)
  if (errors.length) {
    console.log("\nerrors:")
    for (const o of errors) console.log(`  #${o.case.id}: ${o.error}`)
  }
  return summary
}

async function main() {
  const cases   = loadCases()
  const backend = evalBackend(args.backend!, args.model ?? null)
  const status  = await backend.status()
  if (status.state !== "ready" && status.state !== "idle") {
    throw new Error(`The ${backend.id} backend isn't ready (${status.state}${status.detail ? ": " + status.detail : ""})` +
      (backend.id === "ollama" ? " — run: ollama serve, and ollama pull gemma3:4b" : ""))
  }
  const sensitivity = args.sensitivity as Sensitivity
  if (!SENSITIVITIES.includes(sensitivity)) throw new Error(`--sensitivity must be one of ${SENSITIVITIES.join(", ")}`)
  const model = (status.model ? `${backend.id} · ${status.model}` : backend.id) +
    (sensitivity === "balanced" ? "" : ` · ${sensitivity}`)

  process.stdout.write(`Loading ${model}… `)
  await backend.warm()
  console.log("ready")
  // Chat context only ever goes to a backend on this computer
  const recentOf = (c: Case) => (backend.local ? recentFor(c) : [])

  const outcomes: Outcome[] = []
  for (const [i, c] of cases.entries()) {
    const start = performance.now()
    const skip = args["no-language-check"] ? null : unsupportedLanguage(c.text, backend.id)
    if (skip) {
      outcomes.push({ case: c, result: null, skipped: skip, ms: 0 })
      process.stdout.write(`\r${i + 1}/${cases.length}`)
      continue
    }
    try {
      const ctx    = fullContext(c.context)
      const result = await backend.judge(c.text, ctx, recentOf(c), { timeoutMs: 120_000, sensitivity })
      const outcome: Outcome = { case: c, result, ms: performance.now() - start }
      if (args.advice && result.tone !== "green") {
        const adviceStart = performance.now()
        outcome.suggestion = (await backend.advise(c.text, result, ctx, args.style as SuggestionStyle, recentOf(c), { timeoutMs: 120_000 })).suggestion
        outcome.adviceMs   = performance.now() - adviceStart
      }
      outcomes.push(outcome)
    } catch (err) {
      outcomes.push({ case: c, result: null, error: (err as Error).message, ms: performance.now() - start })
    }
    process.stdout.write(`\r${i + 1}/${cases.length}`)
  }
  process.stdout.write("\n")

  const summary = report(outcomes, model)
  const outDir = path.join(DIR, "results")
  const before = args.compare ? previousRun(outDir, cases) : null
  const now = metrics(outcomes)
  const missed = reportTargets(now, before, backend.id === "ollama")

  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify({ backend: backend.id, model, sensitivity, summary, metrics: now, outcomes }, null, 2))
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`)
  if (args.check && missed.length) {
    console.error(`\nMissed: ${missed.join(", ")}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
