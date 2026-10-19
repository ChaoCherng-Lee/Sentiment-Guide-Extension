# Sentiment Guide Chrome Extension

A Chrome extension that analyses tone as you type on WhatsApp Web, and optionally Instagram DMs and Gmail — like Grammarly, but for kindness. It flags harsh or unkind language in outgoing messages.

## Features

- **Outgoing analysis** — as you type, a popup appears if your message sounds harsh, with an explanation and a kinder alternative you can accept in one click
- **Emoji-aware** — emoji count as tone: "sure 🙂" can read as cold, "💀" usually means laughing
- **Chat context** *(opt-in, off by default)* — checks can read the last 6 messages in the chat, so a joke reads differently from an argument. Names, emails and phone numbers are taken out first, and the messages only go to your local model
- **Incoming analysis** *(opt-in, off by default)* — a small dot on a received message says how it probably reads ("probably teasing", "might be sarcastic") when that isn't obvious; hover or focus it for a short, hedged explanation. It explains — it never judges the sender
- **More sites, one by one** — Instagram direct messages and Gmail can be switched on in the options page (**Sites…** in the toolbar popup); Chrome asks for permission to that site only then
- **Email-aware on Gmail** — checks the paragraph you're writing as you go, and the whole email when you press Send (a flagged email waits for you to fix it or choose **Send anyway**). Rewrites default to Formal, and quoted replies and signatures are left alone
- **Runs entirely locally** — tone analysis is done by a local Ollama model (`gemma3:4b`) on your own machine; nothing is sent to any external AI service, and no API key is required
- **Personalised suggestions** — an onboarding flow collects your role, age range, texting style, and goals so the model tailors its language to you
- **Parent dashboard** *(optional)* — a separate web app (`dashboard/`) where a parent sees a weekly summary: suggestions taken, yellow and red flags per week, and which apps and kinds of message. Counts only, never message text. Try it with made-up data: `cd dashboard && npm install && npm run dev`, then open `/?demo`
- **Private by default** — messages never leave your device; your profile stays on-device only. Sharing with a parent's dashboard is optional: it needs a Supabase project configured at build time *and* the child entering their parent's pairing code

## How It Works

Every outgoing message is sent to a local Ollama server (`http://localhost:11434`) running the `gemma3:4b` model, along with your onboarding profile as context. It returns:
- `tone` — `green`, `yellow`, or `red`
- `label` — a short description (e.g. "A little sharp")
- `explanation` — 1–2 warm sentences about how the message might land
- `flagged_phrase` — the exact word or phrase that triggered it
- `suggestion` — a kinder rewrite of the full message (outgoing only)

Because the model runs on your own computer, there's no per-message API cost, no rate limit, and no key to manage.

## Setup

### 1. Install and start Ollama

1. Download Ollama for your OS from [ollama.com/download](https://ollama.com/download) and install it
2. Start the Ollama server (the installer usually starts it automatically as a background app; if not, run in a terminal):
   ```
   ollama serve
   ```
3. Pull the model this extension uses:
   ```
   ollama pull gemma3:4b
   ```
4. Leave Ollama running in the background — the extension talks to it over `http://localhost:11434` any time you're using WhatsApp Web

### 2. Build and load the extension

The extension is built with [WXT](https://wxt.dev) and needs Node.js 20+.

```
npm install
npm run build      # production build → .output/chrome-mv3
```

1. Go to `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder

For development, `npm run dev` opens a Chrome window with the extension
loaded and reloads it on every change. `npm run zip` makes a store-ready zip.

### 3. Check the connection

1. Click the Sentiment Guide icon in the Chrome toolbar
2. The popup shows a green dot with "Ollama running · gemma3:4b" once it can reach the local model. If it shows red, it'll tell you which command to run (`ollama serve` or `ollama pull gemma3:4b`)

### 4. Complete onboarding (optional)

On first install, an onboarding page opens automatically. It asks:
- **Who is setting this up** — child/teenager or parent/carer
- **Age range** — 8–10, 11–13, 14–16, or 17+
- **Texting style** — e.g. "I say it straight", "I use lots of slang"
- **Goals** — e.g. sounding kinder, avoiding arguments, understanding replies
- **Suggestion voice** — casual, gentle, or direct

You can skip onboarding and adjust settings later via the popup.

## Usage

1. Open [web.whatsapp.com](https://web.whatsapp.com) and start a chat. To use it on Instagram or Gmail too, open **Sites…** in the toolbar popup and switch the site on
2. Type a message — if it contains harsh language, a popup appears above the compose box
3. Read the explanation, then **Apply** a single phrase swap (only those words change), **Replace all (Tab)** with the full rewrite, or **Dismiss** to send as-is
4. Pick how rewrites should sound — **Casual**, **Formal** or **Direct** — in the toolbar popup (your default) or with the style buttons in the suggestion popup (remembered for that chat). Chats you marked as formal in the context form start in Formal
5. After your first flagged message, the popup offers **chat context**: with it on, checks read the last 6 messages in the chat so they know what you're replying to. The popup says *Checked with the last few messages in this chat* when it was used. Switch it on or off any time under **Chat context** in the toolbar popup
6. To take a break, use the toolbar popup: switch it off, **Pause 1 hour** or **Pause until tomorrow**. `Alt+Shift+G` turns it on or off, and **Don't check this chat** in the suggestion popup turns it off for one chat. The toolbar icon shows `OFF` or `II` while it isn't checking
7. To get help reading messages you receive, switch on **Messages you receive** in the toolbar popup (or tick it during onboarding). Only the last 3 received messages are read when a chat opens, then new ones as they arrive. Your own checks always go first. **Was this helpful?** 👍/👎 is counted on your computer only

See [CHANGES.md](CHANGES.md) for what is new compared with the original extension.

## Project layout

| Path | Purpose |
|---|---|
| `wxt.config.ts` | Build config; the manifest is generated from it |
| `entrypoints/background.ts` | Service worker — queues tone checks to the local Ollama, AI status, optional Supabase logging |
| `entrypoints/whatsapp.content.ts` | Content script — picks the WhatsApp adapter and starts the engine |
| `entrypoints/popup/`, `entrypoints/onboarding/` | Toolbar popup and first-run page |
| `src/analysis/` | Prompts, JSON schema + validation, Ollama client, request queue |
| `src/platforms/` | One adapter per site (WhatsApp, Instagram, Gmail); all page selectors live here. `sites.ts` lists the optional sites |
| `entrypoints/options/` | Options page: switch optional sites on and off |
| `src/engine/` | `ComposeSession` (one per compose box) and the engine that wires everything |
| `src/ui/` | Suggestion popup, highlight, context form, status chip (Shadow DOM) |
| `src/settings/store.ts` | Typed settings and per-chat data |
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
                   # (an e2e build, with every optional site pre-allowed — run `npm run build` before loading .output by hand)
npm run eval       # tone evaluation on eval/messages.jsonl (needs Ollama running)
```

Run `npm run eval` before and after any prompt change and include the
summary line in the commit message.

## Privacy

- Your messages are never stored or logged by this extension
- Incoming analysis is off unless you turn it on. Received messages are read from the page, sent only to your local Ollama, and never stored, logged or sent to Supabase; readings are kept in memory for the open tab only
- Chat context is off unless you turn it on. When on, the last 6 messages (each cut to 200 characters, with the contact's name, emails and phone numbers removed) are read from the page at check time, sent only to your local Ollama, and never stored, logged or sent to Supabase
- Text is only sent to your local Ollama server (`http://localhost:11434`) — never to an external server
- Your profile is stored locally using `chrome.storage.local`
- No API key is required or used
- Optional sharing with a parent: only if the extension was built with a Supabase project (`WXT_SUPABASE_URL` / `WXT_SUPABASE_ANON_KEY` in `.env`, see `.env.example`) **and** the child reads what is shared, agrees, and links to a parent with a 6-digit pairing code under **Sites… → Share with a parent**. Until then nothing is sent. Only counts are shared — per flagged message: yellow/red, a category from a fixed list (e.g. "sarcasm"), confidence, whether the suggestion was taken, the app, and the time. Never message text, rewrites, flagged words, contacts, chat context, incoming readings or context answers. "Shared with parent: on" shows in the toolbar popup, **Unlink and delete my data** removes everything shared, and the server deletes events after 90 days. The database rules (`supabase/migrations/`) let each child write only their own rows and a parent read only rows of children linked to them

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
