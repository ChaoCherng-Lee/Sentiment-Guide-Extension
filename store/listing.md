# Chrome Web Store listing (Plan 12.4)

Copy these into the developer dashboard. **The name is a placeholder**: Spec
open question 3 (the product name) is still open. Change it here, in
`wxt.config.ts` (`manifest.name`) and in the policy page before submitting.

## Name

Sentiment Guide

## Summary (132 characters at most)

Check how your message comes across before you send it — kinder rewrites in your own voice, privately, on the sites you chat on.

## Category

Communication

## Description

Ever sent a message and realised too late it sounded harsher than you meant? Sentiment Guide reads the message you're writing — on WhatsApp Web, Discord, Messenger, Gmail, Reddit and other sites — and tells you, before you hit Send, if it might come across as hurtful.

• A small badge by the box turns yellow or red when a message might land badly, and the words that do it are underlined.
• Pick from two or three rewrites in your own voice, or change just the words that sting.
• Red messages pause on Send so you get a second look. Send anyway is one click, or Ctrl+Enter.
• "It's fine" teaches it: messages like ones you said were fine stop being flagged.
• Gentle, Balanced or Strict: choose how readily it flags.
• Knows tone tags (/j, /s), banter between friends, and what emoji can imply.

Private by design
• Choose where checks happen: Chrome's built-in AI or Ollama on your own computer (nothing you write leaves it), or a private cloud check that keeps nothing.
• Never touches password, card, one-time-code or address fields. Banking, health and government sites are off unless you turn them on.
• No ads, no selling data, no message text in any log. Delete everything with one click.

Works from the keyboard and with screen readers.

## Single purpose

Shows the person writing a message how it might come across to the reader, and offers kinder ways to say it, before it is sent.

## Permission justifications

| Permission | Why it's needed |
|---|---|
| Host permission: web.whatsapp.com (at install) | The main place people use it: reads the message being written in WhatsApp Web's message box to check its tone, and puts in a rewrite when the person picks one. |
| Optional host permissions: all websites, instagram.com, mail.google.com | **Asked for only when the person switches a site on** in setup or Settings → Sites. "All websites" is needed because people write messages on many sites (Discord, Messenger, Telegram Web, X, Reddit, LinkedIn, Slack, comment boxes, forums), and a list of sites can't cover them. On each page it only reads a text box while the person is writing in it; it never reads the rest of the page, and skips password, card, one-time-code and address fields, login forms, and banking, health and government sites. |
| Host permission: 127.0.0.1:11434 and localhost:11434 | Talks to Ollama, the AI the person can run on their own computer. |
| Host permission: *.supabase.co | The private cloud check, opt-in diagnostics, and (family edition only) sharing counts with a parent. |
| storage | Keeps settings, the weekly tally and what "It's fine" taught it, on the computer. |
| alarms | Resumes checking after a pause, sends opt-in diagnostics once a day, and fetches updated site selectors. |
| scripting | Starts checking on a site the person allowed, without reloading the page. |
| offscreen | Runs Chrome's built-in AI (Gemini Nano) in an offscreen document, where the service worker can't. |
| declarativeNetRequestWithHostAccess | Removes the Origin header from its own requests to Ollama on the computer, which otherwise refuses requests from extensions. Applies to nothing else. |

## Data use disclosures (Privacy practices tab)

- Collects: **website content** (the message being written, only to check it; not kept). Nothing else is collected unless the person turns on diagnostics (anonymous counts, no text, no sites) or, in the family edition, parent sharing (counts per flagged message, no text).
- Not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- Privacy policy URL: publish `entrypoints/policy/index.html` (also built as `policy.html` in the extension) and give its address.

## Screenshots

1280 × 800, made by `npm run screenshots` (store/screenshots/). **These are
drafts** from the plain test pages; for the store, take them on the real
sites (with test accounts and made-up chats), keeping the same four scenes:

1. `1-card.png`: a flagged comment with the card and its rewrites
2. `2-whatsapp.png`: a harsh WhatsApp message, flagged with underlines
3. `3-where.png`: choosing where checks happen (setup)
4. `4-privacy.png`: Settings → Privacy
