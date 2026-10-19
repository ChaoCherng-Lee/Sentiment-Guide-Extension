// =============================================================================
// Tone evaluation — runs every labelled message in eval/messages.jsonl
// through the real prompt + local Ollama and reports how well it does.
//
//   npm run eval                          # whole set
//   npm run eval -- --category emoji      # one category (or several: emoji,slang)
//   npm run eval -- --limit 20 --model gemma3:4b
//   npm run eval -- --advice              # also time step 2 on flagged messages
//   npm run eval -- --advice --style formal
//   npm run eval -- --category context --no-recent   # same cases without the chat
//
// Cases with "recent" carry the last few chat messages (chat context, 2.3).
// The "context" category has pairs: the same message after a joking thread
// and after an argument, which should come out differently.
//
// Accuracy comes from step 1 (the verdict), which decides what gets flagged.
//
// Run it before and after every prompt change and put the summary line in
// the commit message. Results are also written to eval/results/.
//
// The expected labels are a team judgement call, not ground truth — review
// and correct them in messages.jsonl as you go.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { listModels, pickModel, warmUp } from "../src/analysis/ollama"
import { adviseTone, judgeTone } from "../src/analysis/tone"
import type { ChatContext, ChatMessage, SuggestionStyle, Tone, ToneVerdict } from "../src/analysis/types"

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
    file:     { type: "string", default: path.join(DIR, "messages.jsonl") },
    advice:   { type: "boolean", default: false },
    style:    { type: "string", default: "casual" },
    "no-recent": { type: "boolean", default: false },
  },
})

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

  console.log(`\nModel: ${model} · ${done.length}/${outcomes.length} cases answered\n`)

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

  console.log("\nper category (exact match)")
  for (const cat of [...new Set(done.map(o => o.case.category))]) {
    const inCat = done.filter(o => o.case.category === cat)
    const ok = inCat.filter(o => predicted(o) === o.case.expected).length
    console.log(`  ${cat.padEnd(12)} ${pct(ok, inCat.length)}  (${ok}/${inCat.length})`)
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
  const errors = outcomes.filter(o => !o.result)
  if (errors.length) {
    console.log("\nerrors:")
    for (const o of errors) console.log(`  #${o.case.id}: ${o.error}`)
  }
  return summary
}

async function main() {
  const cases = loadCases()
  const model = pickModel(await listModels(), args.model ?? null)
  if (!model) throw new Error("No Gemma model installed — run: ollama pull gemma3:4b")

  process.stdout.write(`Loading ${model}… `)
  await warmUp(model)
  console.log("ready")

  const outcomes: Outcome[] = []
  for (const [i, c] of cases.entries()) {
    const start = performance.now()
    try {
      const ctx    = fullContext(c.context)
      const result = await judgeTone(c.text, ctx, { model, timeoutMs: 120_000 }, recentFor(c))
      const outcome: Outcome = { case: c, result, ms: performance.now() - start }
      if (args.advice && result.tone !== "green") {
        const adviceStart = performance.now()
        outcome.suggestion = (await adviseTone(c.text, result, ctx, args.style as SuggestionStyle, { model, timeoutMs: 120_000 }, recentFor(c))).suggestion
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
  mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify({ model, summary, outcomes }, null, 2))
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
