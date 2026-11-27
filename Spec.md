# Sentiment Guide — Product Spec (consumer edition)

_Status: draft · Last updated: 2026-11-21 · Plan: [Plan.md](Plan.md)_

This spec turns Sentiment Guide from a working prototype into something a
person would install from the Chrome Web Store and keep. It describes **what**
to build and **why**. `Plan.md` describes the order and the commits.

---

## 1. The problem

People don't send unkind messages because they're unkind. They send them
because they're tired, rushed or upset, and a text has no tone of voice. The
damage happens in the few seconds between typing and pressing Enter, and it
happens mostly in **personal** chats: friends, partners, family, group chats
and comment sections.

The tools people already have don't cover this:

- **Grammarly** has had a tone detector since 2019. It is built for work
  writing (email, documents) and mostly checks correctness and
  professionalism. It doesn't ask whether a message to your friend will hurt.
- **Platform nudges** (Twitter/X, Instagram, TikTok) only work inside one app.
  They're tuned for public abuse, not everyday friction between people who
  like each other.

## 2. Evidence that people need this (not reinventing the wheel)

The two halves of this product have each been tried at scale. We combine
them; we don't invent either.

| Proven pattern | Who did it | What happened |
|---|---|---|
| **A nudge before sending** a possibly hurtful message | Twitter, 2020–21 | **34%** of people who saw the prompt revised their reply or didn't send it. After one prompt, people wrote **11% fewer** offensive replies later on. Twitter also said the prompt fired too often on **sarcasm and friendly banter**, which is our biggest risk too ([NPR](https://www.npr.org/2021/05/06/994138707/want-to-send-a-mean-tweet-twitters-new-feature-wants-you-to-think-again), [Nieman Lab](https://niemanlab.org/2021/05/when-twitter-asked-people-to-be-nicer-they-listened)) |
| "Are you sure you want to post this?" | Instagram, 2019 | Instagram said early tests showed people undo comments and write something less hurtful. It published no numbers ([NPR](https://www.npr.org/2019/07/10/739873066/instagram-to-flag-hateful-comments-before-you-send-them), [TechCrunch](https://techcrunch.com/2019/07/08/instagram-anti-bullying-features)) |
| **Inline suggestions** in any text box: underline, card, one-click fix | Grammarly | The standard UI for writing help in the browser. People already know how it works, so we copy it rather than invent a new one |

Twitter's figures are its own and haven't been independently checked. They're
still the best public evidence that a well-timed nudge changes what people
send.

**What's new about us:** the nudge works **everywhere you write**, not inside
one app. It's tuned for **personal** messages rather than public abuse or work
email. And it's **private by design**: your messages are never stored.

## 3. Who it's for

**Primary user:** an adult (18+) who writes a lot of personal messages on a
laptop or desktop (WhatsApp Web, Instagram, Discord, Messenger, Telegram) and
has sent at least one message they regretted.

What they'd say:

- "Catch me before I send something I'll regret, but don't nag me."
- "Don't make me install anything weird."
- "Don't read my messages, or at least don't keep them."
- "Be right. If you flag my jokes, I'm turning you off."

**Not the target in this edition:** parents monitoring teens. The parent
dashboard and pairing stay in the code but are **left out of the consumer
build** (see FR-10). A "Family" edition can come later, with its own consent
and legal work.

## 4. Product principles

1. **Silent when fine.** Most messages are fine. Showing nothing (or a calm ✓)
   is the default; interrupting is the exception.
2. **Never block, only pause.** The user always has a one-click way to send
   anyway. We never delay a send by more than half a second waiting for the
   AI.
3. **Wrong flags are the worst bug.** One false flag costs more trust than
   one missed flag. When unsure, stay quiet.
4. **Works in one minute.** From the Chrome Web Store to the first check, with
   no terminal, no 3 GB download and no account.
5. **Private by default.** Text is checked and forgotten. Nothing is stored or
   used for training, and the user can always choose fully-on-device.
6. **Copy what works.** Grammarly-style UI, platform-style nudges, Chrome's
   own AI where it exists. We spend our effort on the tone judgement and the
   moment of sending.

## 5. User journey (target)

1. Installs from the Chrome Web Store. The setup tab opens.
2. Setup asks one question, *"Where should checks happen?"*:
   - **Recommended:** on this computer if it can (Chrome's built-in AI),
     otherwise our private cloud check.
   - **Fully private:** Ollama on this computer (advanced).
3. Setup asks to allow **all websites**. One Chrome prompt. Done.
4. Writes "fine, do whatever you want then" in WhatsApp. A yellow underline
   appears. Nothing pops up.
5. Writes "you're honestly pathetic" and presses Enter. The send **pauses**
   with a small card: why it might hurt, two rewrites in their own voice,
   **Send anyway**.
6. Writes "lol you're such an idiot 😂" to a friend. **No flag**, because
   it's banter. If it did flag, one click on **It's fine** teaches it.
7. On Sunday the popup says "This week: you took 4 suggestions 🎉".

## 6. Functional requirements

Priority: **P0** = needed to launch · **P1** = soon after launch · **P2** = later.
✅ = already built (Phases 0–6), possibly needing polish.

### FR-1 Checking (core)

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Check what the user types in any text box (textarea and rich editors) on allowed sites, while typing | P0 ✅ |
| FR-1.2 | Three outcomes: fine (✓), might hurt (yellow underline), likely hurts (red, card opens) | P0 ✅ |
| FR-1.3 | Explain *why* in one short sentence, in plain words, never preachy | P0 ✅ |
| FR-1.4 | Give **2–3 rewrites** that keep the user's voice, language, length and emoji. Today there is one rewrite per style | P0 |
| FR-1.5 | One-click apply of a phrase fix or the full rewrite | P0 ✅ |
| FR-1.6 | Use recent chat messages as context when the user allows it | P1 ✅ |
| FR-1.7 | Explain received messages (opt-in) | P2 ✅ |

### FR-2 The moment of sending

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | On chat sites, pressing Enter or Send on a **red** message pauses the send and shows the card with **Send anyway**, **Edit** and the rewrites. Today only Gmail does this | P0 |
| FR-2.2 | If the check isn't finished when the user sends, wait at most 500 ms. Then let it go and don't nag afterwards | P0 |
| FR-2.3 | Yellow messages never pause a send | P0 |
| FR-2.4 | Users can turn the send pause off (Settings → General) and keep inline checks only | P0 |

### FR-3 Fewer wrong flags

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | **Sensitivity:** Gentle / Balanced (default) / Strict, one setting | P0 |
| FR-3.2 | Every card has **It's fine** with an optional reason (joke or banter / they know me / it's accurate / other). The reason is stored locally | P0 |
| FR-3.3 | **Learns locally** from "It's fine": similar messages to the same chat or site stop being flagged. Stored on the device only | P1 |
| FR-3.4 | Detect the language. Don't flag languages the current AI doesn't handle well; show "not checked: language" on the badge instead | P0 |
| FR-3.5 | Treat friendly profanity, inside jokes and emoji-softened teasing as fine unless aimed to hurt (prompt plus examples, measured by the test set, see NFR-1) | P0 |

### FR-4 AI that just works

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | One AI interface with three interchangeable backends: **Chrome built-in AI** (Gemini Nano via the Prompt API), **private cloud check**, **Ollama** | P0 |
| FR-4.2 | **Chrome built-in AI** where the computer qualifies: Chrome's guidance asks for a GPU with more than 4 GB VRAM, *or* 16 GB RAM and 4+ CPU cores, plus about 22 GB free disk ([Chrome docs](https://developer.chrome.com/docs/ai/get-started)). Show download progress | P0 |
| FR-4.3 | **Private cloud check** for everyone else: a small server function calls a hosted fast model. The API key lives on the server, never in the extension. Text isn't logged or stored, and isn't used for training (the provider's zero-retention setting where offered) | P0 |
| FR-4.4 | **Ollama** stays as the "fully private, advanced" choice | P0 ✅ |
| FR-4.5 | Setup chooses automatically (built-in → cloud) and explains the choice in one line. Settings → The AI lets the user change it | P0 |
| FR-4.6 | If the chosen backend fails, the badge says so. The extension never silently switches to the cloud without permission | P0 |

### FR-5 Where it works

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | WhatsApp Web, Instagram DMs, Gmail with site-aware adapters | P0 ✅ |
| FR-5.2 | Any website via the generic adapter | P0 ✅ |
| FR-5.3 | **Checked and tested** (fixture plus e2e) on the sites the target user lives on: Messenger, Discord, Telegram Web, X, Reddit, LinkedIn, Slack. Tweak the generic adapter or add a small site adapter where needed | P0 for Discord/Messenger/Telegram, P1 for the rest |
| FR-5.4 | Per-site and per-chat off switches | P0 ✅ |
| FR-5.5 | Google Docs and other canvas-drawn editors: say clearly that they aren't supported (badge absent, FAQ entry) | P2 |

### FR-6 Controls and feedback

| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | On/off, pause 1 h / until tomorrow, keyboard shortcut | P0 ✅ |
| FR-6.2 | Popup: this site's switch, AI status, weekly note | P0 ✅ |
| FR-6.3 | Settings tabs: General, Sites, The AI, Privacy (replaces Parent sharing in the consumer build) | P0 |
| FR-6.4 | **Privacy tab:** what is sent where, a "delete everything stored on this computer" button, and the diagnostics switch (NFR-6) | P0 |

### FR-7 Never touch sensitive fields

| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | Never read password, payment card, one-time-code or address fields (`type=password`, `autocomplete="cc-*"`, `one-time-code` and similar), even if they're textareas or editors | P0 |
| FR-7.2 | Off by default on banking, health-portal and government sites (a built-in list the user can override) | P1 |
| FR-7.3 | Respect `data-gramm="false"` and similar opt-outs | P0 ✅ |

### FR-8 Setup

| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | One-page setup: where checks happen, all websites, done. Under one minute on the recommended path | P0 |
| FR-8.2 | A 20-second "try it" box on the setup page with a sample harsh message, so the user sees a flag before leaving | P0 |

### FR-9 Encouragement

| ID | Requirement | Priority |
|---|---|---|
| FR-9.1 | Weekly note in the popup, kept on this computer | P0 ✅ |
| FR-9.2 | No streaks, no guilt, no notifications outside the popup | P0 |

### FR-10 Consumer build vs Family build

| ID | Requirement | Priority |
|---|---|---|
| FR-10.1 | A build flag leaves parent pairing, sharing and its Supabase code out of the consumer build. The code stays in the repo and the Family build still compiles and passes its tests | P0 |

## 7. Non-functional requirements

### NFR-1 Accuracy (measured, not guessed)

- A **labelled test set** of at least 400 short messages lives in the repo:
  harsh, passive-aggressive, blunt-but-fine, banter, profanity-as-emphasis,
  emoji-softened, sarcasm, neutral, and non-English. Each has an expected
  outcome (fine / yellow / red).
- `npm run eval` scores any backend and prompt against it and prints
  precision, recall and false-flag rate per category.
- **Launch targets** (Balanced sensitivity, recommended backend):
  - **False red on fine messages ≤ 2%**; any flag on fine messages ≤ 8%
  - Clearly hurtful messages caught (yellow or red) ≥ 90%
  - Every backend that ships meets these targets, or setup doesn't offer it
- A prompt or model change can't be merged if it makes any target worse.

### NFR-2 Speed

| Measure | Target |
|---|---|
| Typing a character | No visible lag; input handler under 4 ms |
| Verdict after typing stops (cloud / built-in) | p50 ≤ 700 ms, p95 ≤ 1.5 s |
| Verdict on Ollama | Best effort; the badge spinner covers it |
| Holding a send (FR-2.2) | Never more than 500 ms |
| Pages the user only reads | Zero AI calls, zero model load (✅ lazy load) |

### NFR-3 Resource use

- No measurable CPU while idle. Memory added per tab ≤ 15 MB.
- The cloud backend sends only the message (plus context when allowed),
  debounced. Never one request per keystroke.

### NFR-4 Privacy

- Message text is never written to disk, logs, analytics or a server
  database. Only the AI backend sees it, only for the check.
- The cloud function keeps no request bodies. Its logs keep timing and
  status codes only.
- Everything learned (FR-3.3), the weekly tally and settings stay in
  `chrome.storage.local` and can be deleted with one button.
- A plain-language privacy policy page, linked from setup, Settings and the
  store listing.
- Chrome Web Store **Limited Use** policy followed. A written justification
  for the "all websites" permission.

### NFR-5 Security

- No API keys in the extension. The cloud function authenticates each
  install with an anonymous install token and rate-limits it (e.g. 300
  checks/hour), so a leaked token can't run up a bill.
- Content-script UI stays in Shadow DOM. Page text never goes to `innerHTML`.
- Prompt-injection safe: message text goes in as data with a JSON schema for
  the answer (✅ for Ollama; required for every backend).

### NFR-6 Diagnostics (opt-in)

- Off by default. When on: anonymous counts (checks, flags, accepted,
  dismissed with reason, latency, backend, site *category* only) and error
  reports. **Never message text, never site names.**
- **Adapter health:** if a site adapter can't find the compose box where it
  should, the extension falls back to the generic adapter and (with
  diagnostics on) reports "adapter X broken" so we find out before users do.

### NFR-7 Reliability

- Site selectors for WhatsApp, Instagram and Gmail can be updated by a
  **remote JSON config** (data only, no code, which MV3 allows) without a
  store release. Signed, with a built-in fallback.
- One failing upload, check or site never stops the others (✅ upload queue).

### NFR-8 Accessibility

- Card, badge, popup, setup and Settings meet **WCAG 2.2 AA**: full keyboard
  use, visible focus, 4.5:1 contrast in light and dark, screen-reader labels.
- A red flag is announced politely (`aria-live="polite"`) without stealing
  focus from the text box.

### NFR-9 Languages

- Interface text in one strings file, ready for translation.
- Checks at launch: English. P1: the next 3–5 languages the test set shows
  the chosen backend handles to target (FR-3.4 covers the rest honestly).

### NFR-10 Quality and release

- CI on every push: type-check, unit, db, e2e with the fake model, and the
  eval on prompt or model changes.
- Semantic versions, a user-facing "What's new" in Settings, and staged
  rollout through the Chrome Web Store.
- Chrome and Edge at launch (WXT builds both). Firefox P2.

### NFR-11 Cost

- The cloud check must cost under **$0.50 per active user per month** at
  normal use (about 100 checks a day). Measure it in the beta before choosing
  free-tier limits.

## 8. Success metrics (first 8 weeks after launch)

| Metric | Target | Why |
|---|---|---|
| Setup completed (installs that finish setup) | ≥ 70% | Principle 4 |
| Saw a check within 24 h of installing | ≥ 60% | People get the point |
| Suggestion taken when a red card shows | ≥ 30% | Twitter saw 34% for a prompt alone |
| "It's fine" on red cards | ≤ 15% | A live false-flag signal |
| Still active after 4 weeks | ≥ 25% | Would you keep it? |
| Uninstall survey: "too many wrong flags" | the reason given by < 20% of uninstallers | Principle 3 |

These are **starting guesses**. Revisit them after the beta (Plan.md Phase 12).

## 9. Out of scope (this edition)

- Phones (Android/iOS keyboards). Strongly wanted, but a separate product.
- Grammar and spelling. Grammarly does that; we don't compete there.
- Accounts, sign-in, sync across devices.
- Parent monitoring (Family build, later).
- Google Docs and canvas editors.

## 10. Open questions

1. **Cloud provider and model.** Pick by running the eval (NFR-1) on 2–3
   small, fast hosted models, then compare cost and latency. Requirements:
   zero-retention option, JSON output, p95 ≤ 1.5 s.
2. **Who pays for the cloud check?** A free tier with a daily cap, then a
   small subscription? Or local-only free and cloud paid? Decide after the
   beta's cost numbers.
3. **Name.** "Sentiment Guide" describes the tech, not the benefit. Consider
   a name about the moment of sending before the store listing.
4. **Incoming-message help.** Keep it (opt-in), or cut it to keep the
   product focused? Check usage in the beta.

## 11. What changes from the current build

| Area | Now (after Phase 6) | Spec |
|---|---|---|
| AI | Ollama only (setup page helps install) | Built-in AI → private cloud → Ollama (advanced) |
| Sending | Only Gmail pauses a flagged send | Every chat site pauses red messages |
| Rewrites | One per style (Casual/Formal/Direct) | 2–3 in the user's own voice |
| Wrong flags | Dismiss only | "It's fine" with reasons, local learning, sensitivity, language check |
| Accuracy | Hand-tested | Labelled set + `npm run eval` + targets |
| Sites | WhatsApp, Instagram, Gmail + generic | + verified Discord, Messenger, Telegram, X, Reddit, LinkedIn, Slack |
| Parent sharing | In the main build | Family build only |
| Privacy | README notes | Privacy tab, policy page, delete-all, sensitive fields skipped |
| Shipping | Local build | CI, store listing, diagnostics (opt-in), remote selectors |
