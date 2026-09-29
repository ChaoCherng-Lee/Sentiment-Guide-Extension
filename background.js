// =============================================================================
// background.js
// Chrome service worker. Handles tone analysis (Ollama) and Supabase logging.
// =============================================================================

console.log("Sentiment Guide: background worker started")

// -----------------------------------------------------------------------------
// SUPABASE CONFIG (OPTIONAL) — the extension works fully offline via Ollama
// without this. Only needed if you want events logged to a parent dashboard.
// To enable: create a Supabase project, then set these from
// Dashboard → Project Settings → API → Project URL + anon public key
// -----------------------------------------------------------------------------
const SUPABASE_URL      = "https://YOUR_PROJECT_REF.supabase.co"
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY"

// Supabase logging stays off until the placeholders above are replaced —
// no key is required to use the extension
function supabaseReady() {
  return !SUPABASE_URL.includes("YOUR_") && !SUPABASE_ANON_KEY.includes("YOUR_")
}

// -----------------------------------------------------------------------------
// ANONYMOUS CHILD ID
// Generated once on install, stored in chrome.storage.local.
// Never sent to Supabase with any PII — just a stable anonymous identifier
// so the parent dashboard can group events by child.
// -----------------------------------------------------------------------------
let _childId = null

async function getChildId() {
  if (_childId) return _childId
  return new Promise(resolve => {
    chrome.storage.local.get("child_id", (data) => {
      if (data.child_id) {
        _childId = data.child_id
        resolve(_childId)
      } else {
        const id = crypto.randomUUID()
        chrome.storage.local.set({ child_id: id }, () => {
          _childId = id
          resolve(id)
        })
      }
    })
  })
}

// -----------------------------------------------------------------------------
// SUPABASE HELPERS
// Plain fetch against the PostgREST REST API — no SDK needed in a service worker.
// -----------------------------------------------------------------------------

async function sbInsert(table, row) {
  if (!supabaseReady()) return
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(row)
    })
    if (!res.ok) console.log(`Sentiment Guide bg: Supabase insert ${table} failed —`, res.status)
  } catch (err) {
    console.log("Sentiment Guide bg: Supabase insert error —", err.message)
  }
}

async function sbUpsert(table, row, onConflict) {
  if (!supabaseReady()) return
  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer":        "resolution=merge-duplicates"
      },
      body: JSON.stringify(row)
    })
    if (!res.ok) console.log(`Sentiment Guide bg: Supabase upsert ${table} failed —`, res.status)
  } catch (err) {
    console.log("Sentiment Guide bg: Supabase upsert error —", err.message)
  }
}

async function sbPatch(table, filter, patch) {
  if (!supabaseReady()) return
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(patch)
    })
    if (!res.ok) console.log(`Sentiment Guide bg: Supabase patch ${table} failed —`, res.status)
  } catch (err) {
    console.log("Sentiment Guide bg: Supabase patch error —", err.message)
  }
}

// -----------------------------------------------------------------------------
// MODEL DISCOVERY
// Resolve the Ollama model name at runtime. Cached after first lookup.
// -----------------------------------------------------------------------------
let _model = null

async function resolveModel() {
  if (_model) return _model
  try {
    const res   = await fetch("http://localhost:11434/api/tags")
    const data  = await res.json()
    const names = (data.models || []).map(m => m.name)
    const pick =
      names.find(n => n === "gemma3:4b")      ||
      names.find(n => n === "gemma3:latest")  ||
      names.find(n => n.startsWith("gemma3")) ||
      names.find(n => n.startsWith("gemma"))  ||
      "gemma3:4b"
    _model = pick
    return pick
  } catch (_) {
    return "gemma3:4b"
  }
}

// -----------------------------------------------------------------------------
// FIRST INSTALL
// -----------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    getChildId()   // generate and store the child ID immediately
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") })
  }
})

// -----------------------------------------------------------------------------
// MESSAGE LISTENER
// Handles three message types from content_script.js:
//   CHECK_TONE        — run tone analysis, optionally store event in Supabase
//   SAVE_CONTEXT      — upsert context form answers to Supabase
//   UPDATE_ACCEPTANCE — patch suggestion_accepted on an existing event row
// -----------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return

  if (request.type === "CHECK_TONE") {
    checkTone(request.text, request.context || null, request.eventId, request.contactHash)
      .then(sendResponse)
    return true
  }

  if (request.type === "SAVE_CONTEXT") {
    saveContext(request.context, request.contactHash)
    return false
  }

  if (request.type === "UPDATE_ACCEPTANCE") {
    updateAcceptance(request.eventId, request.accepted)
    return false
  }
})

// -----------------------------------------------------------------------------
// SAVE CONTEXT — upsert per child+contactHash
// -----------------------------------------------------------------------------
async function saveContext(context, contactHash) {
  if (!context || !contactHash) return
  const childId = await getChildId()
  await sbUpsert("context_forms", {
    child_id:                 childId,
    contact_hash:             contactHash,
    platform:                 context.platform        || "whatsapp",
    relationship:             context.q1              || null,
    communication_style:      context.q2              || null,
    child_uses_tone_tags:     context.q3              || null,
    recipient_uses_tone_tags: context.q4              || null,
    conversation_mood:        context.q5              || null,
    saved_at:                 new Date(context.savedAt || Date.now()).toISOString()
  }, "child_id,contact_hash")
  console.log("Sentiment Guide bg: context upserted to Supabase")
}

// -----------------------------------------------------------------------------
// UPDATE ACCEPTANCE — patch the suggestion_accepted field on an event row
// -----------------------------------------------------------------------------
async function updateAcceptance(eventId, accepted) {
  if (!eventId) return
  await sbPatch("events", `id=eq.${eventId}`, { suggestion_accepted: accepted })
  console.log("Sentiment Guide bg: acceptance updated →", accepted, "for event", eventId)
}

// -----------------------------------------------------------------------------
// CONTEXT LABEL MAPS (mirrors content_script.js question values)
// -----------------------------------------------------------------------------
const _Q1_LABELS = {
  close_friend: "Close friend",
  classmate:    "Classmate / acquaintance",
  family:       "Family member",
  teacher:      "Teacher / coach",
  romantic:     "Romantic interest",
  new_person:   "Someone I just met"
}
const _Q2_LABELS = {
  very_casual: "Very casual — we joke and tease",
  friendly:    "Friendly but normal",
  polite:      "Mostly polite and careful",
  formal:      "Formal — like emails to a teacher"
}
const _Q3_LABELS = { yes: "yes", sometimes: "sometimes", no: "no" }
const _Q4_LABELS = { yes: "yes", sometimes: "sometimes", no: "no", not_sure: "not sure" }
const _Q5_LABELS = {
  normal:     "Normal, nothing unusual",
  frustrated: "I'm a bit frustrated or upset",
  tense:      "We've been arguing or it's tense",
  responding: "Something happened and I'm responding to it"
}

// -----------------------------------------------------------------------------
// TONE ANALYSIS — call Ollama, validate response, store event in Supabase
// -----------------------------------------------------------------------------
async function checkTone(text, context, eventId, contactHash) {
  console.log("Sentiment Guide bg: checkTone called →", JSON.stringify(text.slice(0, 50)))

  const model = await resolveModel()

  let contextBlock = ""
  if (context && context.q1) {
    contextBlock =
      `User profile context:\n` +
      `- Relationship: ${_Q1_LABELS[context.q1]      || context.q1}\n` +
      `- Communication style: ${_Q2_LABELS[context.q2] || context.q2}\n` +
      `- Child uses tone tags: ${_Q3_LABELS[context.q3] || context.q3}\n` +
      `- Recipient uses tone tags: ${_Q4_LABELS[context.q4] || context.q4}\n` +
      `- Current conversation mood: ${_Q5_LABELS[context.q5] || context.q5}\n` +
      `- Platform: ${context.platform || "whatsapp"}\n\n` +
      `Calibration rules:\n` +
      `- If child uses tone tags = yes AND the message ends in /j: return green unless the content is genuinely harmful beyond the joke framing.\n` +
      `- If relationship = close friend AND style = very casual: only flag genuine unkindness, not banter or teasing.\n` +
      `- If relationship = teacher/coach AND style = formal: flag anything inappropriate in a school context, including mild informality.\n` +
      `- If mood = tense (we've been arguing): distinguish frustration expressed TO the person vs ABOUT a situation — venting about a situation should return green.\n` +
      `- If mood = frustrated: give extra leniency and soften the tone of your explanation.\n` +
      `- If platform = gmail or outlook: apply stricter thresholds — treat all conversations as semi-formal unless relationship is family.\n\n`
  }

  const prompt =
    `You are a tone checker helping a young person communicate more kindly. ` +
    `Analyse the message below and respond ONLY with raw JSON — no markdown fences, no extra text.\n` +
    `{\n` +
    `  "tone": "green or yellow or red",\n` +
    `  "confidence": 0.0 to 1.0,\n` +
    `  "label": "short label, max 60 chars",\n` +
    `  "explanation": "1-2 warm sentences explaining why — age-appropriate, kind older sibling tone",\n` +
    `  "flagged_phrase": "exact verbatim substring from the message that caused concern, or empty string if green",\n` +
    `  "suggestion": "kinder rewrite of the ENTIRE message keeping the same meaning, or empty string if green",\n` +
    `  "tone_tags_detected": true or false\n` +
    `}\n\n` +
    contextBlock +
    `General rules:\n` +
    `- Default to GREEN. Only flag yellow or red if there is a clear reason.\n` +
    `- flagged_phrase must be copied verbatim from the message — never paraphrase.\n` +
    `- suggestion must be a complete rewritten message, not just the flagged word.\n` +
    `- confidence: 1.0 = very sure. 0.7 = somewhat sure. Below 0.7 = genuinely borderline.\n` +
    `- tone_tags_detected: true if the message contains /j, /s, /srs, /lh, /nm, /neg or similar tone tags.\n` +
    `- Never lecture. Sound like a warm, supportive older sibling.\n\n` +
    `Message: "${text}"`

  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: true })
    })

    if (!res.ok) throw new Error("Ollama HTTP " + res.status)

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let raw = ""

    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value, { stream: true }).split("\n")) {
        if (!line.trim()) continue
        let chunk
        try { chunk = JSON.parse(line) } catch (_) { continue }
        if (chunk.error) throw new Error("Ollama error: " + chunk.error)
        raw += chunk.response || ""
        if (chunk.done) break outer
      }
    }

    if (!raw) throw new Error("empty response from Ollama")

    const cleaned   = raw.replace(/```json|```/g, "").trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("no JSON object in response")
    const result = JSON.parse(jsonMatch[0])

    const validTones     = ["green", "yellow", "red"]
    const tone           = validTones.includes(result.tone) ? result.tone : "green"
    const confidence     = typeof result.confidence === "number"
                           ? Math.max(0, Math.min(1, result.confidence)) : 1.0
    const label          = (typeof result.label          === "string" ? result.label          : "").slice(0, 60)
    const explanation    = (typeof result.explanation    === "string" ? result.explanation    : "").slice(0, 300)
    const flagged_phrase = (typeof result.flagged_phrase === "string" ? result.flagged_phrase : "").slice(0, 100)
    const suggestion     = (typeof result.suggestion     === "string" ? result.suggestion     : "").slice(0, 400)
    const tone_tags_detected = result.tone_tags_detected === true

    console.log("Sentiment Guide bg: validated result →", { tone, confidence, label, flagged_phrase })

    // Store yellow/red events in Supabase (green = nothing to log)
    if (tone !== "green" && eventId) {
      const childId = await getChildId()
      sbInsert("events", {
        id:                  eventId,
        child_id:            childId,
        contact_hash:        contactHash || null,
        tone,
        confidence,
        label,
        flagged_phrase,
        suggestion,
        tone_tags_detected,
        suggestion_accepted: null   // updated later via UPDATE_ACCEPTANCE
      })
    }

    return { tone, confidence, label, explanation, flagged_phrase, suggestion, tone_tags_detected }

  } catch (err) {
    console.log("Sentiment Guide bg: error —", err.message)
    return {
      tone: "green", confidence: 1.0, label: "", explanation: "",
      flagged_phrase: "", suggestion: "", tone_tags_detected: false
    }
  }
}
