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
only — no incoming message analysis"). It was built in step 3.1 (opt-in).

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

### Phase 3: Incoming messages

| Step | New for users |
|---|---|
| 3.1 | **Help reading messages you receive (opt-in, off by default).** Switch on **Messages you receive** in the toolbar popup or during onboarding. A dot appears on a received message when it probably isn't plain friendly or neutral: teasing, sarcastic, upset, angry or hard to tell. Hover or focus the dot for a short explanation that always hedges ("probably", "might"), plus **Was this helpful?** 👍/👎, counted on this computer only with no message text. When a chat opens only its last 3 received messages are read, then new ones as they arrive; older messages are never analysed |

### Phase 4: More sites

| Step | New for users |
|---|---|
| 4.1 | **Instagram DMs.** A new options page (**Sites…** in the toolbar popup) switches optional sites on one by one; Chrome asks for permission to that site only when you switch it on, and switching it off removes the permission. Instagram direct messages then get the same checks, rewrites, chat context and incoming readings as WhatsApp. Search boxes and pages outside a DM thread are never checked |
| 4.2 | **Gmail.** Every open compose window is checked separately. While you write, a pause checks the paragraph you're in; pressing **Send** (or Ctrl+Enter) checks the whole email first, and a flagged email waits in the popup until you fix it or choose **Send anyway**. A failed or slow check (over 20 s) never stops an email going. **Replace all** swaps only the checked paragraph, so the greeting, other paragraphs, quoted replies and signature stay as they were. Rewrites start in Formal, the model is told it's an email, and the context form doesn't pop up (it's still under **Edit context**). With chat context on, the emails in the thread are the context; with incoming analysis on, received emails get a badge next to the sender's name. The context form no longer offers Outlook, which isn't supported |

### Phase 5: Parental dashboard

| Step | New for users |
|---|---|
| 5.1 | **Safe parent sharing (groundwork).** Sharing now needs a parent account and a pairing code: a parent signs in with email and gets a single-use 6-digit code (valid 15 minutes); the child enters it under **Sites… → Share with a parent**, which links the two. The child's extension uses an anonymous account, so no name or email is needed. The database rules let a child write only their own rows, let a parent read only the rows of children linked to them, and let nobody but the owner change or delete anything. Five wrong codes in an hour lock pairing for that hour. The Supabase keys are no longer in the source; they come from a build setting |
| 5.2 | **Consent and sharing only counts.** Before pairing, the child sees in plain language what a parent will and won't see, and must tick "I understand" before the code box unlocks. "Shared with parent: on" shows in the toolbar popup whenever it is on. Each flagged message now shares only: yellow/red, a category from a fixed list (insult, joke that could hurt, sarcasm, dismissive, harsh tone, threat, leaving someone out, other), confidence, whether the suggestion was taken, the app and the time. **Unlink and delete my data** deletes everything shared; the server deletes events older than 90 days every night. Uploads that fail (offline) wait and are retried every 15 minutes, and nothing is uploaded while the extension is paused |
| 5.3 | **Parent dashboard.** A separate web app (`dashboard/`) where a parent signs in, gets a pairing code, and sees a weekly summary for each linked child. Good news comes first ("Took 3 of 4 suggestions this week"), then: flagged messages per week (yellow and red) for 12 weeks, the share of suggestions taken per week, and flagged messages by app and by kind for the last 4 weeks. Every chart has hover details and a "Show as a table" view, and it works in light and dark mode and on a phone. A parent can stop seeing a child's summary. `?demo` shows it with made-up data. The original had no dashboard |

### Phase 6: Easier to use (after Plan.md: "make it feel like Grammarly")

| Step | New for users |
|---|---|
| 6.1 | **Faster flags.** The quick check no longer asks the model for an unused field, so a flag appears about 0.4 s sooner (2.7 s instead of 3.1 s on the test laptop), and a check starts 0.7 s after you stop typing instead of 1.2 s |
| 6.2 | **A status badge in every message box**, like Grammarly's. A small round button in the box's bottom-right corner always says what's happening: ◆ on, a spinner while checking, a green ✓ when the message sounds fine, yellow or red ! when it's flagged, and grey when paused or off for this chat. When the AI isn't running or the model is missing it turns amber, and clicking it opens setup. Clicking it otherwise opens a small menu: pause for an hour, don't check this chat, settings. It replaces the old status chip, which only appeared when something was wrong |
| 6.2 | **A quieter card.** Red flags still open the card straight away. Yellow ones only underline the words and colour the badge; the card opens when you rest the pointer on the underlined words or click the badge. The card is shorter: the reason, the phrase fixes, then the full rewrite with the style buttons next to it. "Edit context", "Don't check this chat" and Settings moved behind "⋯". × now just closes the card (the message stays flagged and can be opened again); **Dismiss** still means "leave this message alone" |
| 6.3 | **Setup without a terminal.** The welcome page is now a setup page. It finds Ollama, or links to its download and notices by itself once it's running; downloads the AI model with one button and a progress bar (a download that stops can be carried on); then asks your choices. It opens on install, and again from the amber badge or **Set up the AI** in the toolbar popup whenever the AI isn't ready. Before, the popup told you to run `ollama serve` or `ollama pull gemma3:4b` in a terminal |
| 6.4 | **Every website, not just three.** Text boxes on any website are checked too: comments, posts, forms, other chat apps. Plain text boxes (`<textarea>`, which most websites use) work as well as rich editors: the underline sits on the words and phrase fixes swap just those words. On ordinary websites the badge only shows on the box you're using, and "Don't check this …" switches off the whole site rather than a chat. The setup page asks to allow all websites (on by default; Chrome asks once). WhatsApp, Instagram and Gmail keep their own, site-aware checks. A parent's dashboard counts these as "Other websites", never which website. The card now opens below the words when they're near the top of the window |
| 6.5 | **A simpler toolbar popup and a Settings page.** The ◆ popup keeps to the quick things: on/off and pause, a switch for the site you're on, whether the AI is ready (with **Set up** when it isn't), and your week. Everything else moved to **Settings**, which has four tabs: General (suggestion style, chat context, messages you receive), Sites (all websites, Instagram, Gmail, and the sites you switched off, each with **Turn back on**), Parent sharing, and The AI. Before, the popup held every option and the options page only had sites and sharing |
| 6.6 | **Your week.** The popup cheers you on: "This week: you took 6 suggestions 🎉", or how many messages were flagged. The tally starts again each Monday, stays on this computer, and isn't shared with a parent. Picking another rewrite style for the same message no longer counts (or shares) it twice |

### Phase 7: Measure first (after round 2 of Plan.md, for a consumer launch)

| Step | New for users |
|---|---|
| 7.1 | **A bigger test set (no change in the extension).** `eval/messages.jsonl` grew from 210 to 400 labelled messages. New kinds: passive-aggressive ("per my last message…"), blunt but fine ("no, I can't make it tonight"), swearing for emphasis vs at someone ("this traffic is fucking insane" vs "fuck you"), and 30 messages in other languages. Banter, sarcasm, slang and tense chats were topped up to 30 each, with more grown-up situations (partners, flatmates, work). A unit test checks every line. The labels are a judgement call and need a second person's review |
| 7.2 | **The eval checks the Spec targets (no change in the extension).** `npm run eval` now ends with the Spec numbers, each marked ✓ or ✗ against its target: false red on fine messages (≤ 2%), any flag on fine messages (≤ 8%), hurtful messages caught (≥ 90%), and how long a verdict takes (p50 ≤ 0.7 s, p95 ≤ 1.5 s; best effort on Ollama). Each category shows its own false flags and catches. `--compare` shows the change from the last saved run, and `--check` fails when a target is missed, for CI later |
| 7.3 | **"It's fine" instead of Dismiss.** The card's Dismiss button is now **It's fine**. The message is left alone as before, and the card turns into one question for a few seconds: *what was it?* (a joke between us / they know what I mean / it's true and needs saying / something else). Answering is optional; typing on closes it. Only counts are kept, on this computer: how many flags were marked fine, by colour and reason, plus a "fine" count in the weekly tally. No text is stored. This is the live signal for wrong flags (Spec §8) and what 9.4 will learn from |

### Phase 8: AI that just works

| Step | New for users |
|---|---|
| 8.1 | **One way in for every AI (no change for users).** Checks no longer call Ollama directly. They go through one `ToneBackend` interface (`src/analysis/backend.ts`), and Ollama is its first backend. A `backend` setting says which one to use (Ollama for everyone so far). The queue, the engine and `npm run eval` (now `--backend`) work with any backend, so Chrome's built-in AI and the cloud check can be added next to it. Chat context still only goes to a backend on this computer |
| 8.2 | **Chrome's built-in AI as a backend.** Checks can run on Gemini Nano, the model built into Chrome (Prompt API), on computers that meet Chrome's requirements (a GPU with more than 4 GB, or 16 GB of RAM and 4+ cores, and about 22 GB free). Like Ollama it runs on this computer, so chat context may use it, but there's nothing to install. Each check reuses a ready session for its prompt, so only the message itself is new work. If the background worker can't use the Prompt API, a hidden extension page runs the model instead (new `offscreen` permission). Until Chrome has downloaded its model, the badge says so and opens setup rather than checking. Nobody is switched over yet; setup offers it in 8.4 |
| 8.3 | **A private cloud check as a backend.** For computers that can't run a model, checks can go to a small server function (`supabase/functions/tone-check`, in the same Supabase project as parent sharing). It asks a hosted model (Claude Haiku by default; any OpenAI-compatible one with a setting) exactly the questions the extension asks locally, because the prompts are built on the server from a copy of the extension's own code. The message is checked and forgotten: nothing stores it, and the function logs only timing and status. The chat itself never goes to the cloud (chat context isn't offered with it). Each browser gets an anonymous install token on first use, so the function can cap checks at 300 an hour per install and 20 new installs an hour per network without knowing who anyone is. When the cap is reached the badge says so. No API key is in the extension. Nobody is switched over yet; setup offers it in 8.4 |

## Changed behaviour worth knowing

- **8.3 needs setting up before it works:** the rate-limit migration
  (`20261121000000_cloud_rate_limit.sql`), two secrets (`TONE_TOKEN_SECRET`,
  `TONE_API_KEY`: a model provider account, which costs money per check)
  and deploying the function; see README → *The private cloud check*. Not
  yet scored with `npm run eval -- --backend cloud`, because that needs the
  deployed function and an API key. Which model ships, and who pays, are
  still open questions (Spec §10).

- **8.2:** tested with a stand-in for Chrome's `LanguageModel` (unit and
  end-to-end), not on real Gemini Nano: the test laptop is below Chrome's
  requirements, and `npm run eval` runs in Node, where the Prompt API
  doesn't exist. Before offering it by default, score it on a supported
  computer and check that the offscreen page works there. Chrome's model
  understands English, Spanish, German, French and Japanese.

- **7.2 baseline (round 2 starts here):** the current prompt on `gemma3:4b`,
  all 400 messages. False red on fine messages **0.9%** ✓ (target ≤ 2%);
  hurtful messages caught **93.4%** ✓ (≥ 90%); but **any flag on fine
  messages 27.1%** ✗ (target ≤ 8%), so about one fine message in four
  gets a yellow underline. The worst kinds: blunt but fine (60% flagged),
  sarcasm about a situation (70%), swearing for emphasis (50%), the joking
  half of the context pairs (50%) and slang (42%). Verdicts take 2.9 s
  (p50) and 4.4 s (p95) on the test laptop. On the old 210 messages the
  same run gave 16.4% false flags; the new messages are harder on purpose.
  Phase 9 works on this number.

- **6.1:** measured with the eval on the same day and model, before and
  after: on the original 190 messages, exactly right stayed at 86.8% and
  false flags went from 13.0% to 12.0%; the quick check went from 3.14 s to
  2.70 s on average. Both runs score below October's 87.9%, which was
  measured with an older Ollama; the difference isn't from this change.
  A smaller context window was tried too, but the largest prompts (a long
  message with chat context, or a whole email on Send) wouldn't fit.

- **6.2:** a yellow flag no longer pops up a card on its own. If a test or a
  habit relied on the card appearing for every flag, look at the badge
  instead (it turns yellow or red for every flag).

- **6.4:** "all websites" is one Chrome permission covering every site,
  so allowing it also switches on Instagram and Gmail. Each can still be
  switched off by name in Settings, and any website from its text box.
  Before the model is loaded on an ordinary website, Sentiment Guide waits
  for a text box to be used, so just reading pages costs nothing.
  **Needs a database change for parent sharing:** run
  `supabase/migrations/20261113000000_web_platform.sql` (SQL Editor, or
  `supabase db push`). Until then the server refuses flags from other
  websites; those are skipped and everything else still uploads (before,
  one refused upload held up all the ones after it).

- **5.2:** no longer shared with a parent, compared with the original
  extension: the suggested rewrite, the flagged words, the free-text label,
  the contact hash, whether tone tags were used, and the per-contact context
  form answers (those now stay on this computer only). To give the dashboard
  a safe description, the explanation step now also picks a category from a
  fixed list; anything outside the list is stored as "other".

- **5.1:** nothing is uploaded any more until a child has paired with a
  parent. Before, events were uploaded as soon as keys were filled in, to a
  database anyone could read. The old tables are dropped by the new
  migration rather than migrated, because their rows weren't tied to any
  account. The rules are tested against the real migrations in an in-memory
  Postgres (PGlite); a deliberately loosened rule makes the tests fail.

- **4.2:** text that is already in a message box when the extension finds
  it (a restored draft, or something typed in the first half-second) is now
  checked straight away. Before, it was only checked after the next
  keystroke.

- **4.1:** the extension now asks for the `scripting` permission, used to
  start the Instagram checker only after you allow Instagram. Instagram is an
  *optional* permission, so installing the extension still only gives access
  to WhatsApp Web and the local AI.

- **3.1:** incoming readings never hold up your own checks. They wait behind
  outgoing checks, and an outgoing check interrupts a reading that is already
  running (it runs again afterwards). Measured end to end on the test laptop:
  a flag took 7.1 s with nothing else going on and 7.0 s with three incoming
  readings queued. Readings are kept in memory for the open tab only.

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

- **The parent dashboard has only been seen with made-up data.** Like
  sharing, it needs a real Supabase project to try for real. Its numbers are
  unit-tested (`test/unit/dashboard-stats.test.ts`); its pages were checked
  by eye with `?demo`, in light and dark mode and at phone width.

- **Parent sharing hasn't been run against a real Supabase project.** No
  project exists yet (who hosts it, and ethics approval, are open questions in
  the plan). The database rules are tested in PGlite with a stand-in for
  Supabase's auth schema, and the extension's client is tested with a fake
  server. Supabase's anonymous sign-ins must be switched on in the project.

- **Gmail is tested against a hand-built page, not the real Gmail.** The
  selectors (`aria-label="Message Body"`, Send's `data-tooltip`, `.adn` /
  `.gD` / `.a3s` thread messages, `[email]` recipient chips) are long-lived
  ones, but they haven't been tried on the live site. In particular, holding
  Send relies on stopping Gmail's own mouse and keyboard handling for the
  Send button; check this on the real site before relying on it.

- **Instagram is tested against a hand-built page, not a real one.** The
  adapter's selectors come from Instagram's roles and labels as of 2026-10,
  checked against `test/fixtures/instagram/dm-thread.html`, which was written
  by hand because saving a real DM page needs a logged-in account. Save a real
  page into that folder (personal data removed) to check the selectors for
  real. Instagram also changes often, so expect to update the adapter.

- **Incoming badges are untested on the real WhatsApp page.** They are added
  inside the message bubble; if WhatsApp redraws an older bubble the badge can
  disappear until the chat is reopened. There is no eval set for incoming
  readings yet, so their quality is unmeasured.

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
