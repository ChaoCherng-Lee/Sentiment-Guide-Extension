# Sentiment Guide Chrome Extension

A Chrome extension that analyses tone as you type — on WhatsApp Web, Instagram DMs, Gmail and the text boxes of any other website — like Grammarly, but for kindness. It flags harsh or unkind language in what you write.

## Features

- **Outgoing analysis** — as you type, a popup appears if your message sounds harsh, with an explanation and a kinder alternative you can accept in one click
- **Emoji-aware** — emoji count as tone: "sure 🙂" can read as cold, "💀" usually means laughing
- **Chat context** *(opt-in, off by default)* — checks can read the last 6 messages in the chat, so a joke reads differently from an argument. Names, emails and phone numbers are taken out first, and the messages only go to your local model
- **Incoming analysis** *(opt-in, off by default)* — a small dot on a received message says how it probably reads ("probably teasing", "might be sarcastic") when that isn't obvious; hover or focus it for a short, hedged explanation. It explains — it never judges the sender
- **Every website** *(on by default from the setup page)* — comments, posts, forms and other chat apps are checked too, in plain text boxes and rich editors alike. Chrome asks for permission once. Any website can be switched off from its text box (**Don't check this site**) or the toolbar popup, and Instagram DMs and Gmail can also be switched on by themselves under **Settings → Sites**
- **Email-aware on Gmail** — checks the paragraph you're writing as you go, and the whole email when you press Send (a flagged email waits for you to fix it or choose **Send anyway**). Rewrites default to Formal, and quoted replies and signatures are left alone
- **Runs entirely locally** — tone analysis is done by a local Ollama model (`gemma3:4b`) on your own machine; nothing is sent to any external AI service, and no API key is required
- **Your week** — the toolbar popup keeps a private tally and cheers you on ("This week: you took 6 suggestions 🎉"). It stays on your computer and isn't part of parent sharing
- **Personalised suggestions** — an onboarding flow collects your role, age range, texting style, and goals so the model tailors its language to you
- **Parent dashboard** *(optional)* — a separate web app (`dashboard/`) where a parent sees a weekly summary: suggestions taken, yellow and red flags per week, and which apps and kinds of message. Counts only, never message text. Try it with made-up data: `cd dashboard && npm install && npm run dev`, then open `/?demo`
- **Private by default** — messages never leave your device; your profile stays on-device only. Sharing with a parent's dashboard is optional: it needs a Supabase project configured at build time *and* the child entering their parent's pairing code

## How It Works

Each message you write is checked by a local Ollama server (`http://localhost:11434`) running the `gemma3:4b` model, in two steps:

1. **A quick check** (about 2–3 s): `tone` (`green`, `yellow` or `red`), `confidence`, and the `flagged_phrase` that caused it
2. **Advice**, only for yellow and red: a short `label`, an `explanation`, up to 3 phrase swaps (`edits`), a kinder rewrite of the whole message (`suggestion`), notes on emoji, and a `category` from a fixed list

Because the model runs on your own computer, there's no per-message API cost, no rate limit, and no key to manage.

## Setup

### 1. Build and load the extension

The extension is built with [WXT](https://wxt.dev) and needs Node.js 20+.

```
npm install
npm run build      # production build → .output/chrome-mv3
```

1. Go to `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder

For development, `npm run dev` opens a Chrome window with the extension
loaded and reloads it on every change (from its own folder,
`.output/chrome-mv3-dev`). `npm run zip` makes a store-ready zip.

### 2. Follow the setup page

A setup page opens when the extension is installed. No terminal is needed:

1. **Install Ollama** — if it isn't running, the page links to [ollama.com/download](https://ollama.com/download) and notices by itself once Ollama is open
2. **Get the AI model** — one button downloads `gemma3:4b` (3.3 GB) with a progress bar. A download that stops can be carried on where it left off
3. **Your choices** — checking all websites (on by default; Chrome asks to allow it when you press Done) and whether to explain messages you receive

The setup page opens again whenever the AI isn't ready: from the amber badge in a message box, or **Set up** in the toolbar popup. Prefer a terminal? `ollama pull gemma3:4b` does the same as step 2.

## Usage

1. Open [web.whatsapp.com](https://web.whatsapp.com) and start a chat, or click into a text box on any website (if you allowed all websites during setup)
2. Type. The round badge in the corner of the box shows what's happening: a spinner while checking, a green ✓ when it sounds fine, yellow or red ! when it might hurt. On ordinary websites it only shows on the box you're using. Red opens the suggestion card straight away; for yellow, rest the pointer on the underlined words or click the badge
3. Read the explanation, then **Apply** a single phrase swap (only those words change), **Replace all (Tab)** with the full rewrite, or **It's fine** to leave it as it is. The card then asks what it was (a joke between you, they know what you mean, it's true and needs saying); answering is optional and the count stays on your computer
4. Pick how rewrites should sound — **Casual**, **Formal** or **Direct** — under **Settings → General** (your default) or with the style buttons on the card (remembered for that chat). Chats you marked as formal in the context form start in Formal
5. After your first flagged chat message, the card offers **chat context**: with it on, checks read the last 6 messages in the chat so they know what you're replying to. The card says *Checked with the last few messages in this chat* when it was used. Switch it on or off any time under **Settings → General**
6. To take a break, use the ◆ toolbar popup: switch it off, **Pause 1 hour** or **Pause until tomorrow**. `Alt+Shift+G` turns it on or off. The popup also has an **on/off switch for the site you're on**; the badge's menu or the card's ⋯ menu has **Don't check this chat** (on WhatsApp, Instagram, Gmail) or **Don't check this site** (elsewhere). Sites you switched off are listed under **Settings → Sites**. The toolbar icon shows `OFF` or `II` while it isn't checking
7. To get help reading messages you receive, switch on **Messages you receive** under **Settings → General** (or tick it during setup). Only the last 3 received messages are read when a chat opens, then new ones as they arrive. Your own checks always go first. **Was this helpful?** 👍/👎 is counted on your computer only

The toolbar popup also says whether the AI is ready (with **Set up** when it isn't) and how your week is going. **Settings** has four tabs: General, Sites, Parent sharing and The AI.

See [CHANGES.md](CHANGES.md) for what is new compared with the original extension.

## Project layout

| Path | Purpose |
|---|---|
| `wxt.config.ts` | Build config; the manifest is generated from it |
| `entrypoints/background.ts` | Service worker — queues tone checks to the local Ollama, AI status, optional Supabase logging |
| `entrypoints/*.content.ts` | Content scripts — each picks a site's adapter and starts the engine (`web.content.ts`: every other website) |
| `entrypoints/popup/`, `entrypoints/onboarding/` | Toolbar popup (on/off, this site, AI status, your week) and the setup page |
| `src/analysis/` | Prompts, JSON schema + validation, request queue; `backend.ts` is the one interface every AI backend implements (`ollama.ts` today) |
| `src/platforms/` | One adapter per site (WhatsApp, Instagram, Gmail, and `web.ts` for any other website); all page selectors live here. `sites.ts` lists the optional sites |
| `entrypoints/options/` | Settings: General, Sites, Parent sharing, The AI |
| `src/engine/` | `ComposeSession` (one per compose box) and the engine that wires everything |
| `src/ui/` | Suggestion card, highlight, context form, status badge (Shadow DOM); `box-text.ts` reads and measures text in textareas and rich editors alike |
| `src/settings/` | Typed settings and per-chat data (`store.ts`); the private weekly tally (`week.ts`) |
| `eval/` | Labelled messages and the tone evaluation runner |
| `dashboard/` | Parent dashboard: a separate React web app reading the shared counts (see `dashboard/README.md`) |
| `supabase/migrations/` | Database schema and rules for parent sharing (apply in order with `supabase db push`) |
| `test/` | Unit tests (Vitest), database-rule tests (`test/db/`, the real migrations in PGlite) and end-to-end tests (Playwright + fixture pages) |

## Development

```
npm run dev        # Chrome with the extension loaded, reloads on change
npm test           # unit tests
npm run test:e2e   # builds, then runs the extension against fixture pages (~5 min): most tests use a
                   # stand-in model, two use your local Ollama
                   # (its own build in .output/chrome-mv3-e2e, with every optional site pre-allowed)
npm run eval       # tone evaluation on eval/messages.jsonl (needs Ollama running)
```

Run `npm run eval` before and after any prompt change and include the
summary line in the commit message. `npm run eval -- --backend cloud`
scores the deployed cloud check instead.

### The private cloud check (for whoever runs the Supabase project)

The cloud check is a Supabase Edge Function in the same project as parent
sharing (`supabase/functions/tone-check`). It asks a hosted model the
extension's own questions and keeps nothing. To run it:

1. Run `supabase/migrations/20261121000000_cloud_rate_limit.sql` (SQL Editor, or `supabase db push`)
2. Set its secrets: `supabase secrets set TONE_TOKEN_SECRET=<40+ random characters> TONE_API_KEY=<model provider key>`.
   It uses Anthropic's Claude Haiku by default; `TONE_PROVIDER=openai-compatible` with `TONE_BASE_URL` and `TONE_MODEL` uses another provider. Turn on the provider's zero-data-retention setting if it has one
3. `supabase functions deploy tone-check --no-verify-jwt` (the function checks its own install tokens; Supabase's newer `sb_publishable_` keys aren't JWTs)

The prompt code in `supabase/functions/_shared/analysis` is a copy of
`src/analysis`. After changing a prompt, run `npm run sync:function` and
deploy again; a unit test fails while the copy is out of date.

## Privacy

- Your messages are never stored or logged by this extension
- Incoming analysis is off unless you turn it on. Received messages are read from the page, sent only to your local Ollama, and never stored, logged or sent to Supabase; readings are kept in memory for the open tab only
- With the **cloud check** (if you choose it), each message you write is sent to the project's tone-check function and a hosted AI model, checked, and forgotten: neither keeps the text, and the function logs only timing and status. The chat's context answers (e.g. "close friend") go with it; the chat itself never does. Chat context isn't offered with the cloud check. Each browser has an anonymous token so the function can limit checks per hour (300) without knowing who you are
- Chat context is off unless you turn it on. When on, the last 6 messages (each cut to 200 characters, with the contact's name, emails and phone numbers removed) are read from the page at check time, sent only to your local Ollama, and never stored, logged or sent to Supabase
- Text is only sent to your local Ollama server (`http://localhost:11434`) — never to an external server
- Your profile is stored locally using `chrome.storage.local`
- With **all websites** on, the extension can read text boxes on every site, which is why Chrome asks first. It only reads the box you're writing in, and only sends that text to your local Ollama
- No API key is required or used
- Optional sharing with a parent: only if the extension was built with a Supabase project (`WXT_SUPABASE_URL` / `WXT_SUPABASE_ANON_KEY` in `.env`, see `.env.example`) **and** the child reads what is shared, agrees, and links to a parent with a 6-digit pairing code under **Settings → Parent sharing**. Until then nothing is sent. Only counts are shared — per flagged message: yellow/red, a category from a fixed list (e.g. "sarcasm"), confidence, whether the suggestion was taken, the app (WhatsApp, Instagram, Gmail, or just "other websites" — never which one), and the time. Never message text, rewrites, flagged words, contacts, chat context, incoming readings or context answers. "Shared with parent: on" shows in the toolbar popup, **Unlink and delete my data** removes everything shared, and the server deletes events after 90 days. The database rules (`supabase/migrations/`) let each child write only their own rows and a parent read only rows of children linked to them

## Requirements

- Chrome (or a Chromium-based browser) with Manifest V3 support
- [Ollama](https://ollama.com) installed and running locally, with the `gemma3:4b` model pulled
- WhatsApp Web account

## Attribution
Originally created by Evangeline Tanoto, Semester 1 2026, under the supervision of 
Hermann Tsai and Susannah Soon, Curtin University. 
If this project is used in a research publication, please cite:
Evangeline Tanoto. "Sentiment Guide Chrome Extension." 2026. https://github.com/slpevaine/Sentiment-Guide-Chrome-Ext
If used as part of a commercial product, please credit and reach 
out beforehand.

Contributions and continued development by Lee Chao Cherng.
