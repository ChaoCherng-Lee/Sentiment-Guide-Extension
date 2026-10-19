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
| 2.3 | **Chat context (opt-in, off by default).** After the first flag, the popup offers once to let checks read the last 6 messages in the chat, so a joke reads differently from an argument. Turning it on re-checks the message straight away. The toolbar popup has a **Chat context** switch, and the suggestion popup says when the chat was used. Messages are cut to 200 characters, with the contact's name replaced by "Them" and emails and phone numbers removed, before they leave the page. They only go to the local model and are never stored or logged |
| tune | **Less nagging about jokes.** Messages tagged /j, /lh or /s are treated as jokes unless they're cruel even as a joke; /srs means it's meant. In chats marked "we joke and tease", teasing that comes with laughter (lol, haha, 😂, 💀) is let through. Harsh-but-mild messages are now yellow instead of red, so red means real cruelty |

## Changed behaviour worth knowing

- **2.3:** 20 new eval cases: 10 messages, each after a joking thread and
  after an arguing one. Without the chat, 1 of 10 pairs came out
  differently (the words are identical); with it, 5 of 10 do, and 4 of 10
  are both right. Exactly right went from 50% to 60%. The quick check takes
  about 0.15 s longer with the chat (3.5 s vs 3.4 s on these cases). On the
  original 190 messages the prompt change didn't hurt: exactly right 87.9%
  (was 86.8%), false flags 11% (was 12%). One tone-tag case ("nobody likes
  you /j") dropped from red to yellow; one more banter case is now right.

- **Prompt tuning (after 2.2):** on all 190 eval messages, exactly right went
  from 62% to 87%. Fine messages wrongly flagged went from 32% to 12%, and
  yellow/red caught went from 91% to 94%. By category: tone tags 19% → 100%,
  harsh 63% → 100%, banter 0% → 60%, teacher 75% → 100%, tense 50% → 100%,
  emoji 84% → 92%. The quick check takes about 0.15 s longer (4.05 s on
  average).

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

- **Chat context helps less than hoped.** gemma3:4b still flags friendly
  teasing in a joking thread ("you're so dumb 😂" after a funny story) and
  rates exaggerations like "I'm going to kill you 😂" red. Asking the model
  to name the chat's mood first was tried and dropped: it was slower and it
  judged the mood from the message itself.
- **Chat context only hides the chat title's name.** In group chats, other
  people's names inside messages are not removed, and nor is the user's
  own name.

- **Sarcasm and slang are hit and miss** (measured 2026-10-19, gemma3:4b, all
  190 eval messages). Sarcasm about a situation ("perfect, the bus left without
  me") gets flagged, and some sarcasm aimed at someone ("cool story") doesn't:
  8 of 15 right. Harmless slang ("she ate that", "w rizz") is sometimes flagged
  yellow: 12 of 20 right.
- **Name-calling with no chat context** ("you're so dumb") is rated red where
  the eval says yellow. It is still flagged; only the colour differs.
