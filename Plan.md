# Sentiment Guide — Development Plan, round 2 (consumer launch)

_Last updated: 2026-11-21 · Spec: [Spec.md](Spec.md) · Round 1 (Phases 0–6, done) is in [CHANGES.md](CHANGES.md); its plan is commit `655f4f0`_

Round 1 built the features. Round 2 makes it something a person would
install and keep: it works in a minute, it's rarely wrong, it catches you
**at the moment you send**, and it can ship to the Chrome Web Store.

Same rules as round 1:

- **One commit per step.** Phases continue from 6, so CHANGES.md keeps one
  numbering.
- **CHANGES.md** is updated in each step (original vs new).
- Each step leaves type-check, unit, db and e2e tests green.

| Phase | Theme | Steps |
|---|---|---|
| 7 | Measure first | 7.1 Labelled test set · 7.2 `npm run eval` · 7.3 "It's fine" with reasons |
| 8 | AI that just works | 8.1 Backend interface · 8.2 Chrome built-in AI · 8.3 Private cloud check · 8.4 Setup picks for you |
| 9 | Fewer wrong flags | 9.1 Sensitivity · 9.2 Language check · 9.3 Prompt tuned to targets · 9.4 Learns from "It's fine" |
| 10 | The moment of sending | 10.1 Pause red sends on chat sites · 10.2 Rewrites in your voice · 10.3 Verified sites |
| 11 | Consumer edition | 11.1 Consumer/Family builds · 11.2 Sensitive fields · 11.3 Privacy tab · 11.4 Accessibility · 11.5 Performance budget |
| 12 | Ship | 12.1 CI · 12.2 Opt-in diagnostics + adapter health · 12.3 Remote selectors · 12.4 Store listing and policy · 12.5 Beta |

**Decision change:** round 1 said "stay on Ollama". Round 2 reverses that.
Ollama becomes the advanced, fully-private option. Most people will never
install it, and your own computer is below what Gemini Nano needs, so a
cloud option is required too. The model call already lives in one module
(`src/analysis/ollama.ts`), as round 1 planned, so this is mostly additive.

---

## Phase 7 — Measure first

Everything after this changes prompts or models. Without a score, we'd be
guessing whether each change helped.

Round 1 already has `eval/messages.jsonl` (210 messages, labels `green` /
`yellow` / `red`) and `npm run eval` (`eval/run.ts`, Ollama only). Phase 7
grows both to what the Spec needs.

### 7.1 Labelled test set
- `eval/messages.jsonl` grows to at least 400 short messages. New
  categories (Spec NFR-1): `passive_aggressive`, `blunt_fine`, `profanity`,
  `non_english`. Banter, sarcasm, slang and tense are topped up, so each
  Spec category has at least 30.
- Written by hand and checked by a second person where possible. **No real
  people's messages.**
- *Done when:* a unit test validates every line (fields, labels, unique ids)
  and the category minimums.

### 7.2 `npm run eval` reports the Spec targets
- Adds the Spec numbers: **false red on fine**, **any flag on fine**,
  **hurtful caught**, and p50/p95 latency, each checked against its target
  (✓/✗).
- `--compare` shows the difference from the previous saved run.
- First run on the bigger set: the current prompt on `gemma3:4b`. That's
  the baseline.
- *Done when:* the baseline numbers are in CHANGES.md.

### 7.3 "It's fine" with reasons
- The card's Dismiss becomes **It's fine**, with an optional reason chip
  (joke or banter / they know me / it's accurate / other).
- Stored locally as a count by reason; counted in the weekly tally.
- *Done when:* e2e covers dismissing with and without a reason.

## Phase 8 — AI that just works

### 8.1 Backend interface
- `src/analysis/backend.ts`: `interface ToneBackend { id; available(): Promise<Status>; verdict(); advice(); }`.
- `ollama.ts` becomes one implementation. The queue and engine depend only
  on the interface.
- A setting `backend: "auto" | "builtin" | "cloud" | "ollama"`.
- *Done when:* there's no behaviour change and all tests pass with Ollama
  behind the interface.

### 8.2 Chrome built-in AI
- Backend using the Prompt API (`LanguageModel`) with JSON-schema output.
- Reports availability: ready / downloadable (with download progress) /
  unsupported (with why: GPU, RAM, disk).
- Fake `LanguageModel` in e2e. Eval run where the hardware allows.
- *Done when:* the eval meets the Spec NFR-1 targets, or the backend isn't
  offered by default (note the result in CHANGES.md).

### 8.3 Private cloud check
- A Supabase Edge Function `tone-check` (we already use Supabase):
  - takes `{ text, context?, sensitivity, style }` and calls a hosted fast
    model with the API key held server-side;
  - requires an anonymous install token (created on first use), with a
    per-install rate limit;
  - logs only status and timing, never bodies;
  - uses the provider's zero-retention setting where offered.
- Extension `cloud` backend calls it. Timeouts and retries match Spec NFR-2.
- Pick the model with `npm run eval` across 2–3 candidates (Spec open
  question 1). Record the cost per 1,000 checks.
- *Done when:* the eval meets targets, p95 ≤ 1.5 s from the extension, and
  the unit tests cover token, rate limit and "body never logged".

### 8.4 Setup picks for you
- Setup asks "Where should checks happen?" with **Recommended** (built-in if
  ready, else cloud) or **Fully private** (Ollama, the existing guided
  install).
- Adds a "try it" box with a sample harsh message (Spec FR-8.2).
- The Settings → The AI tab shows the current backend and lets the user
  switch. No silent fallback to the cloud (Spec FR-4.6).
- *Done when:* the e2e setup test reaches a first flag in under 60 s with the
  fake cloud backend.

## Phase 9 — Fewer wrong flags

### 9.1 Sensitivity
- Gentle / Balanced / Strict under Settings → General. Each maps to
  verdict thresholds (and prompt wording where needed).
- *Done when:* the eval reports all three, and Balanced meets the targets.

### 9.2 Language check
- Detect the message language (Chrome's `LanguageDetector` where available,
  otherwise a small offline detector).
- Languages a backend isn't eval-approved for get the badge "Not checked:
  language" instead of a guess.
- *Done when:* the non-English eval category shows no false reds.

### 9.3 Prompt tuned to targets
- Add few-shot examples for banter, profanity-as-emphasis, emoji-softened
  teasing and sarcasm. Tighten "red" to "likely to hurt the reader".
- Iterate with `npm run eval --compare` until Balanced meets Spec NFR-1 on
  the recommended backends.
- *Done when:* the targets are met and the before/after table is in
  CHANGES.md.

### 9.4 Learns from "It's fine"
- Keep the last 50 "It's fine" messages per site and per chat **on this
  computer**, as short anonymised snippets.
- Pass the 3 most similar as "this user considers these fine" examples, and
  raise the threshold for that chat.
- Covered by "delete everything" (11.3).
- *Done when:* the unit tests cover similarity and the cap, and e2e shows a
  dismissed kind of message no longer flags in that chat.

## Phase 10 — The moment of sending

### 10.1 Pause red sends on chat sites
- Implement `guardSend`/`sendNow` (today Gmail only) for WhatsApp, Instagram
  and the generic adapter (Enter or form submit).
- Only **red** pauses. Wait at most 500 ms for a check still in flight, then
  let it through. **Send anyway** is always one click or `Ctrl+Enter`.
- Setting: "Pause before sending hurtful messages" (on by default).
- *Done when:* e2e covers red pause, send anyway, yellow not paused, slow
  check let through, and setting off.

### 10.2 Rewrites in your voice
- Advice returns 2–3 rewrites that keep the user's language, length (±30%),
  emoji and slang. Shown as choices on the card; Tab takes the first.
- Casual/Formal/Direct remain as a "make it more…" control.
- Add an eval check: rewrite length and language match the original.
- *Done when:* e2e covers picking the second rewrite, and the eval reports
  the voice checks.

### 10.3 Verified sites
- Fixture pages and e2e for Discord, Messenger and Telegram Web (P0), then
  X, Reddit, LinkedIn and Slack.
- Fix generic-adapter gaps found (send detection, nested editors). Add a
  small site adapter only where the generic one can't cope.
- *Done when:* each listed site has a passing fixture test.

## Phase 11 — Consumer edition

### 11.1 Consumer and Family builds
- `BUILD_EDITION=consumer|family`. Consumer leaves out pairing, sharing, the
  upload queue and Supabase event code. Settings shows a Privacy tab instead
  of Parent sharing.
- CI builds and tests both.
- *Done when:* the consumer bundle has no pairing or sharing code (checked by
  a test) and the family e2e tests still pass.

### 11.2 Sensitive fields
- The generic and site adapters skip password, `autocomplete="cc-*"`,
  `one-time-code`, address and similar fields, and anything inside a form
  with a password input.
- A built-in "off by default" list of banking, health and government sites
  (user can override).
- *Done when:* the fixture has each kind of field and e2e shows no badge on
  any of them.

### 11.3 Privacy tab
- Says what is sent where for the current backend. A **Delete everything on
  this computer** button. The diagnostics switch (12.2). A link to the
  policy.
- *Done when:* e2e covers delete-everything, which clears settings, tally
  and learned examples.

### 11.4 Accessibility
- Keyboard-only path through badge → card → rewrites → send anyway. Visible
  focus. ARIA labels. A polite live announcement for red. Contrast checked in
  both themes.
- Add `@axe-core/playwright` checks to the card, popup, setup and Settings
  tests.
- *Done when:* axe reports no serious violations, and a keyboard-only e2e
  passes.

### 11.5 Performance budget
- An e2e that types 300 characters into a fixture and measures the input
  handler time and memory added per tab.
- *Done when:* the Spec NFR-2 and NFR-3 budgets are enforced by the test.

## Phase 12 — Ship

### 12.1 CI
- GitHub Actions: type-check, unit, db, e2e (fake model) on every push.
  `npm run eval` on changes to prompts or backends (cloud backend via a
  repository secret).
- Needs the branch pushed to GitHub (it is local-only today).

### 12.2 Opt-in diagnostics and adapter health
- Off by default. Anonymous counts and error reports with no text and no
  site names (Spec NFR-6), sent to a Supabase table.
- Adapter health: a site adapter that can't find its compose box falls back
  to the generic adapter and reports it.

### 12.3 Remote selectors
- A signed JSON file of site selectors, fetched daily, with a built-in
  fallback. Data only, no code.

### 12.4 Store listing and policy
- Privacy policy page, store description, screenshots, a justification for
  the "all websites" permission, and a "What's new" panel in Settings.
- Choose the name (Spec open question 3) before this step.

### 12.5 Beta
- 10–20 people for 3 weeks, unlisted store item, diagnostics on by consent.
- Check the Spec §8 metrics, measure cloud cost per user (Spec NFR-11),
  decide pricing (Spec open question 2) and whether to keep incoming
  analysis (open question 4).
- Then public launch.

---

## Before Phase 7: two weeks of using it yourself

Before writing code, use the current build daily on your own chats with
Ollama, and write down:

- every wrong flag;
- every miss;
- every time it got in the way.

Those notes become the first 100 lines of the test set (7.1), with the text
rewritten so it isn't anyone's real message. They also show whether the send
pause (10.1) matters as much as we think.
