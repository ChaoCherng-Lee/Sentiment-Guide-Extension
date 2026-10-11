# Sentiment Guide Chrome Extension

A Chrome extension that analyses tone as you type on WhatsApp Web — like Grammarly, but for kindness. It flags harsh or unkind language in outgoing messages and helps you understand the tone of incoming ones.

## Features

- **Outgoing analysis** — as you type, a popup appears if your message sounds harsh, with an explanation and a kinder alternative you can accept in one click
- **Incoming analysis** — a small coloured dot appears on received messages with strong tone; hover to see an explanation
- **Runs entirely locally** — tone analysis is done by a local Ollama model (`gemma3:4b`) on your own machine; nothing is sent to any external AI service, and no API key is required
- **Personalised suggestions** — an onboarding flow collects your role, age range, texting style, and goals so the model tailors its language to you
- **Private by default** — messages never leave your device; your profile stays on-device only. Optional Supabase logging (for a parent dashboard) is off unless you configure it yourself

## How It Works

Every outgoing/incoming message is sent to a local Ollama server (`http://localhost:11434`) running the `gemma3:4b` model, along with your onboarding profile as context. It returns:
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

1. Open [web.whatsapp.com](https://web.whatsapp.com) and start a chat
2. Type a message — if it contains harsh language, a popup appears above the compose box
3. Read the explanation, then either **Accept** the suggestion (replaces your text) or **Ignore** to send as-is
4. For incoming messages, look for a small coloured dot on bubbles — hover to read the tone note

## Project layout

| Path | Purpose |
|---|---|
| `wxt.config.ts` | Build config; the manifest is generated from it |
| `entrypoints/background.ts` | Service worker — queues tone checks to the local Ollama, AI status, optional Supabase logging |
| `entrypoints/whatsapp.content.ts` | Content script — picks the WhatsApp adapter and starts the engine |
| `entrypoints/popup/`, `entrypoints/onboarding/` | Toolbar popup and first-run page |
| `src/analysis/` | Prompts, JSON schema + validation, Ollama client, request queue |
| `src/platforms/` | One adapter per site; all page selectors live here |
| `src/engine/` | `ComposeSession` (one per compose box) and the engine that wires everything |
| `src/ui/` | Suggestion popup, highlight, context form, status chip (Shadow DOM) |
| `src/settings/store.ts` | Typed settings and per-chat data |
| `eval/` | Labelled messages and the tone evaluation runner |
| `test/` | Unit tests (Vitest) and end-to-end tests (Playwright + fixture pages) |

## Development

```
npm run dev        # Chrome with the extension loaded, reloads on change
npm test           # unit tests
npm run test:e2e   # builds, then runs the extension against fixture pages + your local Ollama
npm run eval       # tone evaluation on eval/messages.jsonl (needs Ollama running)
```

Run `npm run eval` before and after any prompt change and include the
summary line in the commit message.

## Privacy

- Your messages are never stored or logged by this extension
- Text is only sent to your local Ollama server (`http://localhost:11434`) — never to an external server
- Your profile is stored locally using `chrome.storage.local`
- No API key is required or used
- Optional: if you set up your own Supabase project and fill in `SUPABASE_URL`/`SUPABASE_ANON_KEY` in `background.js`, flagged events can be logged there for a parent dashboard. This is off by default.

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
