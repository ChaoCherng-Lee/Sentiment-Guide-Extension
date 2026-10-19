# What's new vs. what was already there

Tracks the work in `Plan.md` against the original extension (commit
`cf17446`, "initial commit"). Updated with every step.

## Already in the original extension

- **WhatsApp Web only.** Checks outgoing messages only, when a sentence ends
  or after a 1.2 s pause.
- **Local AI with Ollama.** It found an installed model automatically and
  rated each message green / yellow / red. It returned a label, an
  explanation, a whole-message rewrite, the flagged phrase, a confidence
  score and whether tone tags (/j, /s …) were used.
- **Highlight** under the flagged phrase.
- **Suggestion popup** above the phrase:
  - "fairly confident" / "borderline" note
  - **Accept (Tab)** replaced the whole message, falling back to the
    clipboard
  - **Dismiss** stopped flagging that exact text
- **Quick context form** per chat: relationship, how you talk, tone tags (you
  and them), current mood. Answers were kept for 7 days and could be changed
  with **Edit context**. Calibration rules in the prompt used the answers.
- **Toolbar popup** showing whether Ollama was reachable.
- **Onboarding page** on install.
- **Optional Supabase logging** with an anonymous child ID: flagged events,
  context answers, whether a suggestion was accepted. Off until keys are set.
  The database rules are not safe yet; Phase 5 fixes them.

Not there, although the original README said it was: **incoming-message
analysis.** The original code ignored incoming messages ("outgoing messages
only — no incoming message analysis"). The README now marks it as planned for
Phase 3.

## New

### Phase 0: Foundation (no new features for users, but it works better)

| Step | Change |
|---|---|
| 0.1 | Bug fixes: stale results dropped, an old suggestion can't be inserted by Tab, no latching onto the search bar, short insults (3+ chars) checked, the popup clears when you click send, and the highlight follows scrolling |
| 0.2 | Rebuilt with WXT + TypeScript; unused permissions removed |
| 0.3 | Code split into modules; all WhatsApp selectors in one adapter, so other sites can be added later |
| 0.4 | New Ollama client: structured JSON answers, a request queue, no `OLLAMA_ORIGINS` setup needed, the model is warmed up when WhatsApp opens. **New:** a status chip above the message box (loading / AI offline / model missing / slow) |
| 0.5 | Unit tests and a 160-message evaluation set (labels need team review) |
| perf | **Faster flags:** a quick yes/no check (~3 s) runs first; the explanation and rewrite follow (~10–15 s) while the popup shows "Thinking…" |

### Phase 1: User controls

| Step | New for users |
|---|---|
| 1.1 | On/off switch, **Pause 1 hour**, **Pause until tomorrow** (7 am), **Resume now** in the toolbar popup; **Alt+Shift+G** on/off; toolbar icon shows `OFF` / `II`; **Don't check this chat** in the suggestion popup |
| 1.2 | **Suggestion style** (Casual / Formal / Direct): a default in the toolbar popup and a per-chat choice in the suggestion popup. Chats marked formal in Quick context start in Formal. The style changes only the rewrite, never what gets flagged |

### Phase 2: Better suggestions

| Step | New for users |
|---|---|
| 2.1 | **Fix just the bad words.** The popup lists up to 3 phrase swaps (`"shut up" → "give me a sec"`), each with its own **Apply** button. Applying one leaves the rest of the message, emoji and cursor where they were, then re-checks the message. The old Accept button is now **Replace all (Tab)** |
| 2.2 | **Emoji count.** Passive-aggressive emoji ("sure 🙂", "whatever 🙄") and insulting ones ("you're a 🤡") are flagged, while laughing ones ("im dead 💀", "😭😭") are left alone. The popup explains how an emoji may come across, and a suggested edit can remove or swap an emoji. A single emoji such as "🙄" is now checked; before, anything under 3 characters was skipped, and "🙄" counted as 2 |

## Changed behaviour worth knowing

- **2.2:** on the 50 emoji cases in the eval set, results went from 68% to
  82% exactly right. Yellow/red messages caught went from 65% to 92%, and
  false flags on fine messages fell from 21% to 12.5%. The extension now
  reads emoji that WhatsApp draws as images, which were invisible to it
  before.

- **2.1:** the explanation and rewrite now take about 13–19 s instead of about
  10 s on the test laptop, because the model also writes the phrase swaps.
  The flag itself still appears after about 3 s. The time limit for the
  explanation and rewrite went from 30 s to 60 s, because some runs went past
  30 s when the laptop was busy.

## Known problems

- **Too strict on teasing and tone tags** (measured 2026-10-19, gemma3:4b, all
  190 eval messages: 62% exactly right). Banter between close friends ("bro
  you're so dumb 💀") is flagged 15 times out of 15, even with the
  close-friend context set. Messages tagged /j or /lh are mostly flagged red
  (3 of 16 right), and slang is right half the time. Yellow messages are often
  rated red. The code from before 2.2 gives the same results, so this was
  there already; it needs prompt work of its own.
