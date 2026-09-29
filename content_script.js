// =============================================================================
// content_script.js
// Injected into WhatsApp Web. Watches the compose box for outgoing messages
// only — no incoming message analysis. Runs tone analysis on sentence
// completion or after a 1200 ms pause and shows a Grammarly-style popup for
// yellow/red results.
//
// Also injects a per-chat context form (slide-up card) so the model can
// calibrate its analysis to the relationship and conversation mood.
// Context is cached per contact in chrome.storage.local for 7 days.
//
// All UI lives in Shadow DOM hosts so styles never leak into WhatsApp.
// =============================================================================

console.log("Sentiment Guide: loaded on", window.location.hostname)

// ── Global state ──────────────────────────────────────────────────────────────
window._sgHost            = null   // popup host div
window._sgShadow          = null   // popup shadow root
window._sgInput           = null   // compose box element
window._sgLastText        = ""     // last text that was analysed
window._sgIgnored         = new Set()
window._sgPopupOpen       = false
window._sgRequestInFlight = false
window._sgCurrentContext  = null   // cached context answers for current chat
window._sgCurrentChatHash = null   // hash of active contact name
window._sgSessionChats    = new Set() // hashes seen this session (skip re-asking)
window._sgCurrentEventId  = null   // Supabase event ID for the popup currently shown

const _SG_PUNCT_DEBOUNCE_MS = 80
const _SG_PAUSE_DEBOUNCE_MS = 1200
const _SG_MIN_TEXT_LEN      = 8
const _SG_CONTEXT_TTL_MS    = 7 * 24 * 60 * 60 * 1000   // 7 days

// Question definitions for the context form
const _SG_QUESTIONS = [
  {
    id: "q1",
    label: "Who is this person to you?",
    options: [
      { value: "close_friend", label: "Close friend" },
      { value: "classmate",    label: "Classmate / acquaintance" },
      { value: "family",       label: "Family member" },
      { value: "teacher",      label: "Teacher / coach" },
      { value: "romantic",     label: "Romantic interest" },
      { value: "new_person",   label: "Someone I just met" }
    ]
  },
  {
    id: "q2",
    label: "How do you usually talk to them?",
    options: [
      { value: "very_casual", label: "Very casual — we joke and tease" },
      { value: "friendly",    label: "Friendly but normal" },
      { value: "polite",      label: "Mostly polite and careful" },
      { value: "formal",      label: "Formal — like emails to a teacher" }
    ]
  },
  {
    id: "q3",
    label: "Do YOU use tone tags? (/j /s /srs)",
    options: [
      { value: "yes",       label: "Yes I use them" },
      { value: "sometimes", label: "Sometimes" },
      { value: "no",        label: "No I don't" }
    ]
  },
  {
    id: "q4",
    label: "Does the OTHER PERSON use tone tags?",
    options: [
      { value: "yes",       label: "Yes they do" },
      { value: "sometimes", label: "Sometimes" },
      { value: "no",        label: "No they don't" },
      { value: "not_sure",  label: "Not sure" }
    ]
  },
  {
    id: "q5",
    label: "What's the current mood of the conversation?",
    options: [
      { value: "normal",      label: "Normal, nothing unusual" },
      { value: "frustrated",  label: "I'm a bit frustrated or upset" },
      { value: "tense",       label: "We've been arguing or it's tense" },
      { value: "responding",  label: "Something happened and I'm responding to it" }
    ]
  }
]

// Delay startup — WhatsApp loads its UI dynamically
setTimeout(init, 3000)

// Re-attach if the compose box disappears (e.g. navigating between chats)
const _sgInitObserver = new MutationObserver(() => {
  if (window._sgInput && document.contains(window._sgInput)) return
  findAndWatch()
})
_sgInitObserver.observe(document.documentElement, { childList: true, subtree: true })

function init() {
  findAndWatch()
  watchChatSwitches()
}

// =============================================================================
// SAFE MESSAGE PASSING
// chrome.runtime becomes undefined on context invalidation; guard every call.
// =============================================================================

function safeSendMessage(msg, callback) {
  try {
    if (!chrome?.runtime?.id) {
      console.log("Sentiment Guide: extension context invalidated — cannot send message")
      return false
    }
    chrome.runtime.sendMessage(msg, callback)
    return true
  } catch (err) {
    console.log("Sentiment Guide: sendMessage threw —", err.message)
    return false
  }
}

// =============================================================================
// COMPOSE BOX — find it, attach listeners
// =============================================================================

function findAndWatch() {
  if (window._sgInput && document.contains(window._sgInput)) return

  const inputBox = getComposeBox()
  if (!inputBox) { setTimeout(findAndWatch, 2000); return }

  console.log("Sentiment Guide: found compose box")
  injectPopup()

  let punctTimer = null
  let pauseTimer = null

  inputBox.addEventListener("input", () => {
    const text = inputBox.innerText.trim()
    clearTimeout(punctTimer)
    clearTimeout(pauseTimer)

    if (!text) { removeHighlight(); hidePopup(); return }
    if (text.length < _SG_MIN_TEXT_LEN) return
    if (window._sgIgnored.has(text)) return

    const lastChar = text.slice(-1)
    const isPunct  = [".", "!", "?"].includes(lastChar)

    if (isPunct) {
      punctTimer = setTimeout(() => analyseOutgoing(text), _SG_PUNCT_DEBOUNCE_MS)
    } else {
      pauseTimer = setTimeout(() => analyseOutgoing(text), _SG_PAUSE_DEBOUNCE_MS)
    }
  })

  inputBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      removeHighlight(); hidePopup()
      window._sgLastText = ""; window._sgIgnored.clear()
    }
    if (e.key === "Tab" && window._sgPopupOpen) {
      e.preventDefault(); doAcceptSuggestion()
    }
  })

  window._sgInput = inputBox
}

function getComposeBox() {
  const selectors = [
    '[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][role="textbox"]',
    'footer [contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"][aria-label]',
    '[data-testid="conversation-compose-box-input"] [contenteditable="true"]'
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]'))
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 50 && r.height > 10 })
  return candidates[candidates.length - 1] || null
}

// =============================================================================
// OUTGOING MESSAGE ANALYSIS
// Only the child's own typed messages are analysed. Incoming messages are
// intentionally ignored.
// =============================================================================

function analyseOutgoing(text) {
  if (window._sgRequestInFlight) return
  if (text === window._sgLastText) return
  if (window._sgIgnored.has(text)) return

  window._sgRequestInFlight = true
  window._sgLastText        = text

  const eventId   = crypto.randomUUID()
  const timeoutId = setTimeout(() => { window._sgRequestInFlight = false }, 20000)

  const sent = safeSendMessage(
    {
      type:        "CHECK_TONE",
      text,
      context:     window._sgCurrentContext || null,
      eventId,
      contactHash: window._sgCurrentChatHash || null
    },
    (result) => {
      clearTimeout(timeoutId)
      window._sgRequestInFlight = false

      if (chrome?.runtime?.lastError) return
      if (!result) return

      // Empty label + explanation means Ollama was unreachable — skip silently
      if (result.tone === "green" && !result.label && !result.explanation) return

      if (result.tone === "green") { hidePopup(); removeHighlight(); return }

      window._sgCurrentEventId = eventId
      showWordHighlight(window._sgInput, result.flagged_phrase, result.tone)
      showPopup(result)
    }
  )

  if (!sent) { clearTimeout(timeoutId); window._sgRequestInFlight = false }
}

// =============================================================================
// CHAT SWITCH DETECTION
// Polls the contact name every 1.2 s. On switch: resets state, checks storage
// for cached context, and shows the context form if needed.
// =============================================================================

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0
  }
  return Math.abs(h).toString(36)
}

function getContactName() {
  const selectors = [
    '[data-testid="conversation-info-header-chat-title"]',
    '#main header span[title]',
    '#main header ._amig span'
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (!el) continue
    const name = el.getAttribute("title") || el.textContent?.trim()
    if (name) return name
  }
  return null
}

function detectPlatform() {
  const host = window.location.hostname
  if (host.includes("whatsapp"))                      return "whatsapp"
  if (host.includes("gmail") || host.includes("mail.google")) return "gmail"
  if (host.includes("outlook"))                       return "outlook"
  return "whatsapp"
}

let _sgContextHost = null

function watchChatSwitches() {
  let lastKnownHash = null
  setInterval(() => {
    const name = getContactName()
    if (!name) return
    const hash = hashString(name)
    if (hash === lastKnownHash) return
    lastKnownHash = hash

    if (hash === window._sgCurrentChatHash) return
    window._sgCurrentChatHash = hash
    window._sgLastText = ""
    window._sgIgnored.clear()
    window._sgCurrentContext = null
    hidePopup(); removeHighlight()

    // Already visited this session — load cached context but don't re-show form
    if (window._sgSessionChats.has(hash)) {
      chrome.storage.local.get("context_" + hash, (d) => {
        window._sgCurrentContext = d["context_" + hash] || null
      })
      return
    }
    window._sgSessionChats.add(hash)

    chrome.storage.local.get("context_" + hash, (d) => {
      const ctx = d["context_" + hash]
      if (ctx?.savedAt && (Date.now() - ctx.savedAt < _SG_CONTEXT_TTL_MS)) {
        window._sgCurrentContext = ctx
        return
      }
      // Show the context form after a brief delay so the chat UI settles
      setTimeout(() => showContextForm(name, hash), 800)
    })
  }, 1200)
}

// =============================================================================
// CONTEXT FORM — slide-up card with chip selectors in Shadow DOM
// =============================================================================

function showContextForm(contactName, chatHash) {
  if (_sgContextHost) { _sgContextHost.remove(); _sgContextHost = null }

  const platform       = detectPlatform()
  const PLATFORM_LABELS = { whatsapp: "WhatsApp", gmail: "Gmail", outlook: "Outlook" }
  const PLATFORM_ORDER  = ["whatsapp", "gmail", "outlook"]
  let currentPlatform  = platform

  // Build questions HTML (no user data interpolated — all hardcoded labels)
  const questionsHTML = _SG_QUESTIONS.map(q =>
    `<div class="question">
       <div class="q-label">${q.label}</div>
       <div class="q-chips">
         ${q.options.map(o =>
           `<button class="chip" data-q="${q.id}" data-value="${o.value}">${o.label}</button>`
         ).join("")}
       </div>
     </div>`
  ).join("")

  const host = document.createElement("div")
  host.id = "sg-context-host"
  host.style.cssText = "position:fixed;bottom:0;left:0;width:100%;z-index:2147483647;pointer-events:none;"

  const s = host.attachShadow({ mode: "open" })

  s.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .form-card {
        background: white;
        border-radius: 20px 20px 0 0;
        padding: 20px 20px 28px;
        max-width: 560px;
        width: 100%;
        margin: 0 auto;
        box-shadow: 0 -6px 32px rgba(0,0,0,0.13);
        border-top: 1px solid #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        pointer-events: auto;
        transform: translateY(100%);
        transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
      }

      .form-card.visible { transform: translateY(0); }

      .form-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 14px;
      }

      .form-title {
        font-size: 15px;
        font-weight: 700;
        color: #111827;
        line-height: 1.3;
      }

      .form-subtitle {
        font-size: 12px;
        color: #9ca3af;
        margin-top: 3px;
      }

      .close-btn {
        background: none; border: none;
        font-size: 22px; color: #9ca3af;
        cursor: pointer; padding: 0 2px;
        font-family: inherit; line-height: 1;
        flex-shrink: 0;
      }
      .close-btn:hover { color: #374151; }

      .platform-row {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 16px;
      }

      .platform-label {
        font-size: 11px;
        font-weight: 600;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .platform-chip {
        background: #eff6ff;
        border: 1.5px solid #93c5fd;
        color: #1d4ed8;
        border-radius: 99px;
        padding: 3px 11px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.12s;
      }
      .platform-chip:hover { background: #dbeafe; }

      .questions {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-height: 52vh;
        overflow-y: auto;
        padding-right: 4px;
        scrollbar-width: thin;
      }

      .question { display: flex; flex-direction: column; gap: 8px; }

      .q-label {
        font-size: 13px;
        font-weight: 600;
        color: #374151;
        line-height: 1.4;
      }

      .q-chips { display: flex; flex-wrap: wrap; gap: 6px; }

      .chip {
        background: #f9fafb;
        border: 1.5px solid #e5e7eb;
        color: #374151;
        border-radius: 99px;
        padding: 5px 13px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.13s;
        white-space: nowrap;
      }
      .chip:hover { background: #f3f4f6; border-color: #d1d5db; }
      .chip.selected {
        background: #4f46e5;
        border-color: #4f46e5;
        color: white;
      }

      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 20px;
        align-items: center;
      }

      .btn-save {
        padding: 9px 28px;
        border-radius: 99px;
        background: #4f46e5;
        color: white;
        border: none;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.13s;
      }
      .btn-save:hover { background: #4338ca; }
      .btn-save:disabled { background: #a5b4fc; cursor: not-allowed; }

      .btn-skip {
        padding: 9px 18px;
        border-radius: 99px;
        background: transparent;
        color: #9ca3af;
        border: 1px solid #e5e7eb;
        font-size: 13px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.13s;
      }
      .btn-skip:hover { color: #374151; background: #f3f4f6; }
    </style>

    <div class="form-card" id="sg-form-card">
      <div class="form-header">
        <div>
          <div class="form-title" id="sg-form-title">Quick context</div>
          <div class="form-subtitle">Helps me give better feedback on your tone</div>
        </div>
        <button class="close-btn" id="sg-form-close">×</button>
      </div>

      <div class="platform-row">
        <span class="platform-label">Platform</span>
        <button class="platform-chip" id="sg-platform-chip">${PLATFORM_LABELS[platform] || "WhatsApp"}</button>
      </div>

      <div class="questions">${questionsHTML}</div>

      <div class="form-actions">
        <button class="btn-save" id="sg-form-save" disabled>Save context</button>
        <button class="btn-skip" id="sg-form-skip">Skip for now</button>
      </div>
    </div>
  `

  // Set contact name safely via textContent (not innerHTML)
  s.getElementById("sg-form-title").textContent = `Quick context — ${contactName}`

  // Platform chip cycles through options on click
  const platformChip = s.getElementById("sg-platform-chip")
  platformChip.addEventListener("click", () => {
    const idx = PLATFORM_ORDER.indexOf(currentPlatform)
    currentPlatform = PLATFORM_ORDER[(idx + 1) % PLATFORM_ORDER.length]
    platformChip.textContent = PLATFORM_LABELS[currentPlatform]
  })

  // Chip selection — single-select per question
  const answers = {}
  s.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const qId = chip.dataset.q
      s.querySelectorAll(`.chip[data-q="${qId}"]`).forEach(c => c.classList.remove("selected"))
      chip.classList.add("selected")
      answers[qId] = chip.dataset.value
      const allAnswered = _SG_QUESTIONS.every(q => answers[q.id])
      s.getElementById("sg-form-save").disabled = !allAnswered
    })
  })

  function dismiss(save) {
    const card = s.getElementById("sg-form-card")
    card.classList.remove("visible")
    setTimeout(() => {
      host.remove()
      if (_sgContextHost === host) _sgContextHost = null
    }, 380)

    if (save) {
      const ctx = {
        platform: currentPlatform,
        q1: answers.q1, q2: answers.q2, q3: answers.q3,
        q4: answers.q4, q5: answers.q5,
        savedAt: Date.now()
      }
      window._sgCurrentContext = ctx
      chrome.storage.local.set({ ["context_" + chatHash]: ctx })
      safeSendMessage({ type: "SAVE_CONTEXT", context: ctx, contactHash: chatHash })
      console.log("Sentiment Guide: context saved for chat", chatHash)
    }
  }

  s.getElementById("sg-form-close").addEventListener("click", () => dismiss(false))
  s.getElementById("sg-form-skip").addEventListener("click",  () => dismiss(false))
  s.getElementById("sg-form-save").addEventListener("click",  () => dismiss(true))

  document.body.appendChild(host)
  _sgContextHost = host

  // Two rAF passes ensure the element is painted before the transition starts
  requestAnimationFrame(() => requestAnimationFrame(() => {
    s.getElementById("sg-form-card").classList.add("visible")
  }))
}

// =============================================================================
// POPUP — inject into Shadow DOM, show, hide
// =============================================================================

function injectPopup() {
  if (document.getElementById("sg-popup-host")) return

  const host = document.createElement("div")
  host.id = "sg-popup-host"
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;"

  const s = host.attachShadow({ mode: "open" })

  s.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .popup {
        background: white;
        border-radius: 12px;
        padding: 14px 16px;
        min-width: 280px;
        max-width: 340px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.15);
        border: 1px solid #eee;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.6;
        position: fixed;
        z-index: 2147483647;
        pointer-events: auto;
        display: none;
      }

      .popup::before {
        content: '';
        position: absolute;
        top: 100%;
        left: var(--caret-left, 50%);
        transform: translateX(-50%);
        border: 8px solid transparent;
        border-top-color: #eee;
      }

      .popup::after {
        content: '';
        position: absolute;
        top: calc(100% - 1px);
        left: var(--caret-left, 50%);
        transform: translateX(-50%);
        border: 7px solid transparent;
        border-top-color: white;
      }

      .popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .tone-badge { display: flex; align-items: center; gap: 6px; }

      .tone-dot {
        width: 8px; height: 8px;
        border-radius: 50%; flex-shrink: 0;
      }
      .tone-dot.yellow { background: #F59E0B; }
      .tone-dot.red    { background: #DC2626; }

      .tone-label { font-weight: 600; font-size: 13px; }
      .yellow .tone-label { color: #92400E; }
      .red    .tone-label { color: #7F1D1D; }

      .close-btn {
        background: none; border: none; cursor: pointer;
        color: #aaa; font-size: 18px; padding: 0;
        line-height: 1; flex-shrink: 0; font-family: inherit;
      }
      .close-btn:hover { color: #555; }

      .confidence-text {
        font-size: 11px;
        color: #9ca3af;
        font-style: italic;
        margin-bottom: 8px;
        display: none;
      }

      .explanation {
        font-size: 12px; color: #555;
        margin-bottom: 10px; line-height: 1.6;
      }

      .suggestion-box {
        background: #f7f7f7; border-radius: 8px;
        padding: 8px 10px; margin-bottom: 10px;
      }

      .suggestion-label {
        font-size: 11px; font-weight: 500;
        color: #888; margin-bottom: 4px;
      }

      .suggestion-text {
        font-size: 12px; font-style: italic;
        color: #333; line-height: 1.5;
      }

      .actions {
        display: flex; gap: 8px;
        align-items: center; flex-wrap: wrap;
      }

      .btn-accept {
        padding: 6px 16px; border-radius: 20px;
        background: #2563EB; color: white;
        border: none; font-size: 12px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      }
      .btn-accept:hover { background: #1D4ED8; }

      .btn-dismiss {
        padding: 6px 14px; border-radius: 20px;
        background: transparent; color: #888;
        border: 1px solid #ddd; font-size: 12px;
        cursor: pointer; font-family: inherit;
      }
      .btn-dismiss:hover { background: #f3f4f6; color: #555; }

      .edit-context-btn {
        background: none; border: none;
        font-size: 11px; color: #c4b5fd;
        cursor: pointer; margin-left: auto;
        font-family: inherit; padding: 0;
        text-decoration: underline;
      }
      .edit-context-btn:hover { color: #7c3aed; }
    </style>

    <div class="popup yellow" id="sg-popup">
      <div class="popup-header">
        <div class="tone-badge">
          <span class="tone-dot yellow" id="sg-tone-dot"></span>
          <span class="tone-label" id="sg-tone-label">A little sharp</span>
        </div>
        <button class="close-btn" id="sg-close">×</button>
      </div>
      <div class="confidence-text" id="sg-confidence"></div>
      <div class="explanation" id="sg-explanation"></div>
      <div class="suggestion-box" id="sg-suggestion-box">
        <div class="suggestion-label">Try:</div>
        <div class="suggestion-text" id="sg-suggestion-text"></div>
      </div>
      <div class="actions">
        <button class="btn-accept" id="sg-accept">Accept (Tab)</button>
        <button class="btn-dismiss" id="sg-dismiss">Dismiss</button>
        <button class="edit-context-btn" id="sg-edit-context">Edit context</button>
      </div>
    </div>
  `

  s.getElementById("sg-close").addEventListener("click", (e) => {
    e.stopPropagation(); ignoreAndDismiss()
  })

  s.getElementById("sg-dismiss").addEventListener("click", (e) => {
    e.stopPropagation(); ignoreAndDismiss()
  })

  s.getElementById("sg-accept").addEventListener("click", (e) => {
    e.stopPropagation(); doAcceptSuggestion()
  })

  s.getElementById("sg-edit-context").addEventListener("click", (e) => {
    e.stopPropagation()
    hidePopup()
    const name = getContactName() || "this person"
    const hash = window._sgCurrentChatHash || hashString(name)
    showContextForm(name, hash)
  })

  document.body.appendChild(host)
  window._sgHost   = host
  window._sgShadow = s
}

function ignoreAndDismiss() {
  const text = window._sgInput?.innerText?.trim()
  if (text) window._sgIgnored.add(text)
  if (window._sgCurrentEventId) {
    safeSendMessage({ type: "UPDATE_ACCEPTANCE", eventId: window._sgCurrentEventId, accepted: false })
    window._sgCurrentEventId = null
  }
  hidePopup(); removeHighlight()
}

function doAcceptSuggestion() {
  const s = window._sgShadow
  if (!s) return

  const suggestion = s.getElementById("sg-suggestion-text").textContent.trim()
  if (!suggestion) return

  const acceptBtn = s.getElementById("sg-accept")

  let inputBox = window._sgInput
  if (!inputBox || !document.contains(inputBox)) {
    inputBox = getComposeBox()
    window._sgInput = inputBox
  }
  if (!inputBox) return

  const prevText = inputBox.innerText.trim()

  function finish() {
    if (window._sgCurrentEventId) {
      safeSendMessage({ type: "UPDATE_ACCEPTANCE", eventId: window._sgCurrentEventId, accepted: true })
      window._sgCurrentEventId = null
    }
    acceptBtn.textContent = "✓ Replaced!"
    setTimeout(() => {
      hidePopup(); removeHighlight()
      window._sgLastText    = ""
      acceptBtn.textContent = "Accept (Tab)"
    }, 1500)
  }

  function fallbackCopy() {
    navigator.clipboard.writeText(suggestion).then(() => {
      acceptBtn.textContent = "✓ Copied — paste (Cmd+V)"
      setTimeout(() => {
        hidePopup(); removeHighlight()
        window._sgLastText    = ""
        acceptBtn.textContent = "Accept (Tab)"
      }, 3000)
    })
  }

  inputBox.focus()

  // execCommand("selectAll") fires synchronously but WhatsApp's Lexical editor
  // syncs its internal selection from the subsequent selectionchange event.
  // Deferring insertText past that event ensures Lexical sees "all selected"
  // before insertText's beforeinput fires, so the replace works correctly.
  document.execCommand("selectAll", false, null)

  setTimeout(() => {
    inputBox.focus()
    document.execCommand("insertText", false, suggestion)
    const newText = inputBox.innerText.trim()
    if (newText !== prevText) { finish(); return }
    fallbackCopy()
  }, 0)
}

// =============================================================================
// SHOW POPUP — populate fields and position above the flagged phrase
// =============================================================================

function showPopup(result) {
  const s = window._sgShadow
  if (!s) return

  window._sgPopupOpen = true

  const popup   = s.getElementById("sg-popup")
  const dot     = s.getElementById("sg-tone-dot")
  const label   = s.getElementById("sg-tone-label")
  const confEl  = s.getElementById("sg-confidence")
  const expl    = s.getElementById("sg-explanation")
  const suggBox = s.getElementById("sg-suggestion-box")
  const suggTxt = s.getElementById("sg-suggestion-text")
  const accept  = s.getElementById("sg-accept")

  accept.textContent = "Accept (Tab)"

  const tone      = result.tone || "yellow"
  popup.className = "popup " + tone
  dot.className   = "tone-dot " + tone

  label.textContent = result.label       || (tone === "red" ? "Unkind" : "A little sharp")
  expl.textContent  = result.explanation || ""

  // Confidence indicator — shown only for yellow/red below 0.9
  const confidence = typeof result.confidence === "number" ? result.confidence : 1.0
  if (confidence < 0.9) {
    confEl.textContent   = confidence < 0.7 ? "borderline — your call" : "fairly confident"
    confEl.style.display = "block"
  } else {
    confEl.style.display = "none"
  }

  if (result.suggestion) {
    suggTxt.textContent   = result.suggestion
    suggBox.style.display = "block"
    accept.style.display  = "inline-block"
  } else {
    suggBox.style.display = "none"
    accept.style.display  = "none"
  }

  popup.style.display = "block"
  positionPopup(popup, result.flagged_phrase)
}

function positionPopup(popup, flaggedPhrase) {
  const inputBox = window._sgInput
  if (!inputBox) return

  const inputRect    = inputBox.getBoundingClientRect()
  let anchorBottom   = window.innerHeight - inputRect.top + 12
  let anchorCenterX  = inputRect.left + inputRect.width / 2

  if (flaggedPhrase) {
    const range = getPhraseRange(inputBox, flaggedPhrase)
    if (range) {
      const rects = Array.from(range.getClientRects())
      if (rects.length) {
        const rect    = rects[0]
        anchorBottom  = window.innerHeight - rect.top + 12
        anchorCenterX = rect.left + rect.width / 2
      }
    }
  }

  const popupWidth = popup.getBoundingClientRect().width || 300
  const left = Math.max(8, Math.min(anchorCenterX - popupWidth / 2, window.innerWidth - popupWidth - 8))
  const caretLeft = Math.max(20, Math.min(anchorCenterX - left, popupWidth - 20))

  popup.style.setProperty("--caret-left", caretLeft + "px")
  popup.style.left   = left + "px"
  popup.style.bottom = anchorBottom + "px"
  popup.style.top    = "auto"
}

// =============================================================================
// HIDE POPUP
// =============================================================================

function hidePopup() {
  window._sgPopupOpen = false
  if (!window._sgShadow) return
  const popup = window._sgShadow.getElementById("sg-popup")
  if (popup) popup.style.display = "none"
}

// =============================================================================
// WORD-LEVEL HIGHLIGHT
// Draws overlay divs using exact pixel coords from Range.getClientRects().
// pointer-events:none so clicks pass through to WhatsApp.
// =============================================================================

function showWordHighlight(inputBox, phrase, tone) {
  removeHighlight()
  if (!phrase || tone === "green") return

  const color      = tone === "red" ? "#DC2626" : "#F59E0B"
  const background = tone === "red" ? "rgba(220,38,38,0.10)" : "rgba(245,158,11,0.12)"

  const range = getPhraseRange(inputBox, phrase)
  if (!range) return

  const rects = Array.from(range.getClientRects())
  if (!rects.length) return

  rects.forEach(rect => {
    if (rect.width < 2) return
    const div = document.createElement("div")
    div.className = "sg-highlight"
    div.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: ${background};
      border-bottom: 2px solid ${color};
      border-radius: 2px;
      pointer-events: none;
      z-index: 9998;
    `
    document.body.appendChild(div)
  })
}

function removeHighlight() {
  document.querySelectorAll(".sg-highlight").forEach(el => el.remove())
}

// =============================================================================
// HELPERS
// =============================================================================

// Walk every text node inside `container`, concatenate them, find `phrase`,
// and return a Range pointing at it. This is the only correct way to map a
// phrase back to a DOM position in WhatsApp's Lexical-based compose box.
function getPhraseRange(container, phrase) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes  = []
  let   full   = ""
  let   node

  while ((node = walker.nextNode())) {
    nodes.push({ node, start: full.length })
    full += node.textContent
  }

  const idx = full.toLowerCase().indexOf(phrase.toLowerCase())
  if (idx === -1) return null

  for (const entry of nodes) {
    const nodeEnd = entry.start + entry.node.textContent.length
    if (idx >= entry.start && idx < nodeEnd) {
      try {
        const range = document.createRange()
        range.setStart(entry.node, idx - entry.start)
        range.setEnd(entry.node, Math.min(idx - entry.start + phrase.length, entry.node.textContent.length))
        return range
      } catch (_) {
        return null
      }
    }
  }
  return null
}
