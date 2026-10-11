# Sentiment Guide — Development Plan

_Last updated: 2026-09-29_

This plan covers the next round of work on the extension. Each requirement is
delivered as **its own commit** (the parental dashboard is the one exception;
it is too big and is split into three). Phases are ordered so that each one
builds on what the previous phase put in place.

| Phase | Theme | Commits |
|---|---|---|
| 0 | Foundation: bug fixes, restructure, test harness | 0.1 – 0.5 |
| 1 | User controls | 1.1 On/off/pause · 1.2 Suggestion style |
| 2 | Better suggestions | 2.1 Partial acceptance · 2.2 Emoji checking · 2.3 Chat context |
| 3 | Incoming messages | 3.1 Opt-in incoming analysis |
| 4 | More sites | 4.1 Instagram · 4.2 Gmail |
| 5 | Parental dashboard | 5.1 Auth & pairing · 5.2 Consent & data minimisation · 5.3 Dashboard app |

**Decision: stay on Ollama.** Moving to Gemini Nano is **not planned**. The
model call will still live in one module (`src/analysis/ollama.ts`), so a
different backend could be added later without touching the rest of the code.

---

## Should we change frameworks / architecture?

**Yes, a moderate change. The stack itself isn't wrong, but it won't scale
to this feature list.**

Today the extension is plain JavaScript with no build step. Almost all of
the logic sits in one 1,000-line `content_script.js` that keeps its state in
global `window._sg*` variables and is hard-wired to WhatsApp's page structure.
The features above would roughly triple its size and require:

- the same logic running on 3 sites with different page structures,
- several compose boxes open at once (Gmail can have many compose windows),
- shared settings used by the popup, the options page, the background worker
  and the content scripts,
- a request queue in the background worker, because Ollama handles one
  request at a time by default and incoming analysis must not delay outgoing
  checks,
- a separate web app for the parental dashboard.

Chrome does not let content scripts listed in the manifest use ES module
imports, so splitting the code into modules properly **needs a bundler**.

### Recommendation

| Area | Now | Proposed | Why |
|---|---|---|---|
| Build tooling | None | **[WXT](https://wxt.dev)** (built on Vite) | Generates the manifest, one entry file per content script/page, live reload, Chrome/Edge/Firefox builds from one codebase |
| Language | JavaScript | **TypeScript** | The message types, LLM response schema and platform adapters benefit a lot from types |
| In-page UI | Shadow DOM + template strings | **Keep** Shadow DOM, split into modules | Works well and keeps styles from leaking; no UI framework needed |
| Popup / options page | Plain HTML | Plain TS (switch to Svelte or Preact only if the options page grows) | Keep dependencies light |
| Site support | WhatsApp hard-coded | **Platform adapter interface** | Adding a site = writing one adapter file |
| State | `window._sg*` globals | One `ComposeSession` object per compose box | Needed for Gmail's multiple compose windows |
| Settings | Scattered `chrome.storage` calls | One typed settings store | One source of truth, with changes pushed to every part of the extension |
| LLM calls | `/api/generate` + hand-written JSON parsing | `/api/chat` + a **JSON schema passed as `format`** | Ollama returns schema-valid JSON (requires Ollama ≥ 0.5) and a system prompt keeps user text separate from instructions |
| Tests | None | **Vitest** for logic, a small **labelled evaluation set** for prompt quality | Prompts change in almost every phase, so we need to catch regressions |
| Dashboard | Only an SQL file | Separate `dashboard/` app (Vite + React + Supabase JS) | It is a website, not part of the extension |

A lighter option is to keep plain JS and split the content script into several
classic scripts that share globals. It is cheaper now, but gets messy by
Phase 4. **Not recommended.**

### Target layout (after Phase 0)

```
Sentiment-Guide-Chrome-Ext/
├── wxt.config.ts
├── entrypoints/
│   ├── background.ts
│   ├── whatsapp.content.ts        # thin: picks adapter, starts the engine
│   ├── instagram.content.ts       # Phase 4
│   ├── gmail.content.ts           # Phase 4
│   ├── popup/                     # status + quick controls
│   ├── options/                   # full settings page
│   └── onboarding/
├── src/
│   ├── analysis/                  # prompts.ts, schema.ts, ollama.ts, queue.ts
│   ├── platforms/                 # types.ts, whatsapp.ts, instagram.ts, gmail.ts
│   ├── engine/                    # compose-session.ts, incoming-watcher.ts
│   ├── ui/                        # suggestion-popup.ts, highlight.ts, context-form.ts, incoming-badge.ts
│   ├── settings/                  # store.ts (typed, with change events)
│   └── messaging.ts               # typed messages between content scripts and background
├── eval/                          # messages.jsonl + run.ts
├── dashboard/                     # Phase 5, separate web app
└── supabase/                      # schema + migrations
```

### Platform adapter interface

Every site implements this interface; the rest of the code never queries the
page's DOM directly.

```ts
interface PlatformAdapter {
  id: "whatsapp" | "instagram" | "gmail"
  findComposeBoxes(): HTMLElement[]
  getConversationId(): string | null                 // hashed before leaving the adapter
  getRecentMessages(limit: number): ChatMessage[]    // Phase 2.3
  observeIncoming(cb: (msg: IncomingMessage) => void): () => void  // Phase 3
  replaceText(box: HTMLElement, range: Range | "all", text: string): boolean
  onConversationChange(cb: () => void): () => void
}
```

---

## Phase 0: Foundation

These commits add no new features. They make the features that follow
cheaper and safer to build.

### 0.1 `fix outstanding tone-check bugs`
These go in *before* the migration, so the fixes are kept even if the
restructure is paused.
- Drop stale results: tag each request with the text it analysed and ignore
  the response if the compose box has changed since. After an in-flight
  request finishes, re-check the latest text.
- Clear the old suggestion text when a result has no suggestion, so Tab can't
  insert a stale one.
- Stop the retry timers in `findAndWatch` from piling up (allow only one
  pending retry at a time), and throttle the page-wide MutationObserver.
- Remove the "last contenteditable" fallback that can attach to the search bar.
- Allow short messages: lower `_SG_MIN_TEXT_LEN` (e.g. to 3) so "kys" or
  "ur dumb" are checked.
- Clear the popup and highlight when the message is sent with the send
  button, not only with Enter.
- Update highlight positions on scroll, resize and input.
- Fix the clipboard fallback text (Ctrl+V vs Cmd+V depending on OS).

### 0.2 `migrate to WXT + TypeScript`
- Scaffold WXT and move the existing files into `entrypoints/` unchanged in
  behaviour.
- Move the manifest settings into `wxt.config.ts`. Remove unused permissions
  (`scripting`, `activeTab`, `tabs`, `clipboardWrite`) and add icons.
- Add `npm run dev` / `build` / `zip` scripts and update the README setup
  steps.
- **Done when:** a loaded `.output/chrome-mv3` build behaves exactly like the
  current extension.

### 0.3 `split content script into modules + WhatsApp adapter`
- Extract `src/platforms/whatsapp.ts` (all WhatsApp selectors in one place),
  `src/ui/*` and `src/engine/compose-session.ts`.
- Replace the `window._sg*` globals with a `ComposeSession` object.
- Add `src/settings/store.ts`: typed defaults, `get`, `set`, `subscribe`
  (backed by `chrome.storage.onChanged`). Preferences go in
  `chrome.storage.sync`; per-chat data goes in `chrome.storage.local`.

### 0.4 `rework Ollama client: chat API, JSON schema, request queue`
- `src/analysis/ollama.ts`: `/api/chat` with a system prompt, `stream: false`,
  `format: <JSON schema>`, an `AbortController` timeout, and `keep_alive` so
  the model stays loaded between checks.
- `src/analysis/queue.ts`: a priority queue (outgoing = high, incoming = low).
  A newer outgoing request cancels an older one from the same compose box.
- Restrict the Ollama address to `localhost` / `127.0.0.1`. The privacy
  promise depends on this.
- Show an "AI offline" state in the page instead of failing silently.

### 0.5 `add unit tests and tone evaluation set`
- Vitest tests for the prompt builder, response validation, phrase-to-DOM
  range mapping and the settings store.
- `eval/messages.jsonl`: about 150 labelled messages (banter, tone tags,
  sarcasm, slang, emoji, harsh, neutral). `eval/run.ts` reports precision and
  recall per tone, the false-positive rate and average response time.
- Run it before and after every prompt change in Phases 1–3 and record the
  numbers in the commit message.

---

## Phase 1: User controls

### 1.1 `add on/off and pause controls`
**Goal:** the user can put the extension on hold at any time.

- **Settings:** `enabled: boolean`, `pausedUntil: number | null`,
  `disabledConversations: string[]` (hashes).
- **Popup:** a main toggle, plus buttons for "Pause 1 hour", "Pause until
  tomorrow" and "Resume".
- **In-page:** a "Don't check this chat" option in the suggestion popup.
- **Toolbar badge:** shows `OFF` or `II` when inactive (`chrome.action.setBadgeText`).
- **Keyboard shortcut:** a `commands` entry (e.g. `Alt+Shift+G`) toggles on/off.
- **Auto-resume:** `chrome.alarms` resumes the extension when `pausedUntil`
  expires (adds the `alarms` permission).
- **Content scripts:** subscribe to settings changes. When the extension
  becomes inactive: cancel pending requests, hide the popup and highlights,
  and remove incoming badges.
- **Done when:** toggling in the popup takes effect in open WhatsApp tabs
  without a reload, a paused extension sends **no** requests to Ollama, and
  the pause survives a browser restart.

### 1.2 `add suggestion style selector (casual / formal / direct)`
**Goal:** the user picks what the rewrites sound like.

| Style | Rewrites should… |
|---|---|
| Casual | sound like texting a friend; slang and emoji are fine |
| Formal | be polite with full sentences and no slang, suitable for teachers or email |
| Direct | be short and clear; remove the harshness but keep the point |

- **Settings:** `suggestionStyle` (global default). Each chat can override it,
  and "Formal" is pre-selected when the chat context says "formal".
- **UI:** a selector in the popup and options page. The in-page popup gets a
  small style chip that **regenerates** the suggestion when changed.
- **Prompt:** style instructions affect **only the `suggestion` field**, never
  the tone judgement. Check this with the evaluation set: tone scores must
  not move when the style changes.
- **Done when:** switching style changes rewrites visibly, and evaluation
  scores stay the same.

---

## Phase 2: Better suggestions

### 2.1 `add partial acceptance (phrase-level suggestions)`
**Goal:** replace only the problem phrase, not the whole message.

- **Schema:** add
  `edits: [{ original: string, replacement: string, reason: string }]`
  next to the whole-message `suggestion`.
- **Validation (background):** drop any edit whose `original` is not an exact
  substring of the message, and limit the list to 3 edits.
- **UI:** each edit is shown as a row (`"shut up" → "give me a sec"`
  **[Apply]**), with **Replace all** kept for the whole rewrite. Tab still
  means Replace all.
- **Applying an edit:** find the phrase's range with `getPhraseRange`, select
  it with the Selection API, then insert the replacement the same deferred way
  as today (for WhatsApp's editor). Check that the text changed; if not, copy
  to the clipboard instead. Re-check the message after each applied edit.
- This goes through `adapter.replaceText(box, range, text)`, because Gmail and
  Instagram editors behave differently.
- **Done when:** applying one edit leaves the rest of the message untouched,
  including cursor position and emoji.

### 2.2 `add emoji-aware tone checking`
**Goal:** emoji count as tone signals ("ok 🙂" can read as passive-aggressive;
"💀" usually means laughing).

- **Lexicon:** add `src/analysis/emoji-lexicon.json` with common ambiguous
  emoji and their typical readings (🙂 🙄 💀 😐 👍 🖕 😂 🤡 …). Only entries
  for emoji that **appear in the message** go into the prompt, which keeps
  the prompt short.
- **Prompt and schema:** `flagged_phrase` may be an emoji. Add
  `emoji_notes: [{ emoji, reading }]` for the explanation. Suggestions may
  swap or remove an emoji.
- **Counting and highlighting:** measure message length in graphemes with
  `Intl.Segmenter`, so an emoji-only message like "🙄" can still be checked
  in a tense chat. Test highlighting with skin-tone and combined (ZWJ) emoji.
- **Done when:** the evaluation set gains about 30 emoji cases and handles
  them correctly.

### 2.3 `add opt-in chat context for analysis`
**Goal:** the model sees the last few messages, so "you're so dumb 😂" after
a joke reads differently from the same words mid-argument.

**Does this breach privacy?** It doesn't have to, if these rules are enforced:

1. **The text stays on the device.** Recent messages go only to the local
   Ollama, which Phase 0.4 restricts to localhost. If a remote model is ever
   added, chat context must be switched off for it.
2. **Nothing is stored or logged.** Context is read from the page when needed,
   kept only in memory, and never written to storage or sent to Supabase or
   the dashboard.
3. **Minimal.** Last 6 messages at most, each cut to 200 characters. Names
   are replaced with `Me` / `Them`, and phone numbers and emails are removed.
4. **Opt-in and visible.** Off by default. After the first flag, a one-time
   prompt offers to turn it on and says what it does. The popup shows when
   it's active.
5. **The other person's messages.** They didn't consent, but processing them
   locally is comparable to the user reading them. This is another reason
   they must never reach the parental dashboard.

_(Not legal advice. Confirm with the supervisor/ethics office before any
study with real users.)_

- **Adapter:** `getRecentMessages(limit)` returns
  `{ from: "me" | "them", text }[]` for the open chat.
- **Prompt:** add a "Recent conversation (context only — do not judge these
  messages)" block before the message being checked.
- **Speed:** longer prompts make responses slower. Measure average response
  time in the evaluation run and keep the context size within an acceptable
  delay.
- **Follow-up idea (not in this commit):** use the context to pre-fill the
  "conversation mood" question in the context form.
- **Done when:** the evaluation set gains context cases (the same message
  with a joking thread vs an arguing thread) that come out differently.

---

## Phase 3: Incoming messages

### 3.1 `add opt-in incoming message analysis`
**Goal:** help the user *understand* messages they receive, e.g. "This is
probably teasing, not anger." It explains; it doesn't judge.

- **Setting:** `incomingAnalysis: false` by default; turned on in options or
  onboarding.
- **Adapter:** `observeIncoming(cb)` watches the message list for **new**
  incoming bubbles. When a chat opens, only the last 3 incoming messages are
  checked, so the backlog isn't analysed.
- **Separate prompt and schema:**
  `{ reading: "friendly" | "teasing" | "neutral" | "sarcastic" | "upset" | "angry" | "unclear", confidence, explanation }`.
  Explanations always hedge ("probably", "might").
- **Queue:** these requests are low priority, so outgoing checks always go
  first. Results are cached per message (hash of text + timestamp) for the
  session.
- **UI:**
  - A small dot next to the bubble, shown only when the reading isn't
    obviously neutral or friendly.
  - Hover or focus opens a tooltip with the explanation.
  - "Was this helpful?" 👍/👎, stored locally only.
- **Privacy:** same rules as 2.3. Incoming text is never stored, logged or
  sent to the dashboard.
- **Fix the README**, which already claims this feature exists.
- **Done when:** in a test chat, new incoming messages get badges without
  noticeably delaying outgoing checks.

---

## Phase 4: More sites

The adapter interface from Phase 0.3 makes each site mostly one file. Both
sites use **optional host permissions** (`optional_host_permissions` +
`chrome.permissions.request`), so users switch sites on one by one in the
options page. This is better for privacy and for Chrome Web Store review.

### 4.1 `add Instagram web DMs support`
- **Matches:** `https://www.instagram.com/direct/*`.
- **Adapter:**
  - Compose box: `[contenteditable="true"][role="textbox"]` inside the DM
    thread.
  - Conversation ID: the thread ID from the URL.
  - Incoming vs outgoing: Instagram's class names are scrambled, so use
    `aria` roles and whether the bubble sits on the left or right.
- **Risk:** Instagram's page structure changes often. Keep saved HTML
  snapshots in `test/fixtures/instagram/` and a test that checks the adapter
  selectors against them, so breakage is caught quickly.

### 4.2 `add Gmail compose support`
- **Matches:** `https://mail.google.com/*`.
- **Adapter:**
  - Supports **multiple compose windows** (one `ComposeSession` each).
  - Body: `div[aria-label="Message Body"][contenteditable="true"]`.
  - Conversation ID: hash of the sorted recipient emails.
  - "Recent messages": the quoted thread when replying.
- **Different behaviour from chat sites:**
  - Emails are long, so check the paragraph being edited on pause, and the
    whole email when Send is clicked.
  - Formal style by default.
  - Partial acceptance (2.1) matters most here.
  - The existing "gmail/outlook = stricter" prompt rule applies.
- **Incoming:** the opened email body (opt-in, same as 3.1).
- **Cleanup:** remove the Outlook option from the context form until Outlook
  is actually supported.

---

## Phase 5: Parental dashboard

This phase conflicts most with the "private by default" promise, so it is
last and **opt-in on both sides**. The current Supabase setup is **not safe
to ship**: the database rules allow anyone to read or write any row, and the
anon key is inside the extension. Everything below replaces it.

**Before starting:** confirm the consent model, how long data is kept and
who hosts the database with the supervisor. Check the Australian Privacy Act
(and the upcoming Children's Online Privacy Code), plus COPPA/GDPR if users
could be outside Australia, and get university ethics approval if it will be
used in a study.

### 5.1 `add Supabase auth, parent–child pairing and strict database rules`
- **Parent side:** signs up with Supabase Auth (email). The parent's page
  generates a single-use 6-digit **pairing code** that expires after
  15 minutes.
- **Child side:** the extension signs in with Supabase **anonymous sign-in**,
  and the child enters the pairing code, which links the accounts in a
  `links(parent_id, child_id)` table.
- **Database rules (RLS):**
  - A child can only insert rows where `child_id = auth.uid()`.
  - A parent can only read rows for children linked to them.
  - Nobody can update or delete except the owner.
- **Credentials:** remove the hard-coded keys from the source and use a build
  setting. The anon key is safe to ship **only** with these rules in place.
- **Migrations:** move `supabase_schema.sql` to `supabase/migrations/`.

### 5.2 `add child consent screen and data minimisation`
- **Consent screen before pairing:** in plain language, what the parent will
  see and what they won't. The child can see "Shared with parent: on" in the
  popup at any time.
- **Data minimisation:** stop uploading `suggestion` (it's effectively the
  whole message) and `flagged_phrase`. Upload only: tone, a label category,
  confidence, whether the suggestion was accepted, the platform and a
  timestamp.
- **Never uploaded:** chat context, incoming analysis, and contact names or
  hashes (drop `contact_hash` from uploads).
- **Deletion and retention:** "Unlink and delete my data" deletes the child's
  rows. A scheduled job deletes events older than 90 days.
- **Upload queue:** failed uploads are queued locally and retried. Nothing is
  uploaded while the extension is paused (1.1).

### 5.3 `add parental dashboard web app`
- **Stack:** `dashboard/` built with Vite + React + `@supabase/supabase-js`,
  deployed as a static site (Vercel/Netlify).
- **Views:**
  - Weekly counts of yellow/red flags
  - A trend chart
  - Suggestion acceptance rate
  - Breakdown by platform
  - **No message text anywhere**
- **Framing:** show positive trends ("accepted 8 of 10 suggestions") before
  warnings. The goal is coaching, not surveillance.

---

## Open questions

1. Which Ollama model and version do we officially support? The structured
   outputs in 0.4 need Ollama ≥ 0.5.
2. Should chat context (2.3) be offered during onboarding or only after the
   first flag?
3. For the dashboard: who hosts the Supabase project (the university or the
   project), and does it need ethics approval?
4. Should Instagram (4.1) wait until 0.5's evaluation set shows an acceptable
   false-positive rate on WhatsApp?
