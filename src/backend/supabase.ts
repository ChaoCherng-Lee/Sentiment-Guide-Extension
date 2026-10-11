// =============================================================================
// Supabase logging (OPTIONAL) — the extension works fully offline via Ollama
// without this. Only needed if you want events logged to a parent dashboard.
// To enable: create a Supabase project, then set these from
// Dashboard → Project Settings → API → Project URL + anon public key
//
// Plain fetch against the PostgREST REST API — no SDK needed in a service worker.
// =============================================================================

import { browser } from "#imports"
import type { ChatContext } from "../analysis/types"

const SUPABASE_URL      = "https://YOUR_PROJECT_REF.supabase.co"
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY"

// Logging stays off until the placeholders above are replaced
function supabaseReady() {
  return !SUPABASE_URL.includes("YOUR_") && !SUPABASE_ANON_KEY.includes("YOUR_")
}

// -----------------------------------------------------------------------------
// Anonymous child ID — generated once, stored in chrome.storage.local. A stable
// anonymous identifier so the dashboard can group events; never linked to PII.
// -----------------------------------------------------------------------------
let childId: string | null = null

export async function getChildId(): Promise<string> {
  if (childId) return childId
  const data = await browser.storage.local.get("child_id")
  if (typeof data.child_id === "string") return (childId = data.child_id)
  const id = crypto.randomUUID()
  await browser.storage.local.set({ child_id: id })
  return (childId = id)
}

async function sbRequest(method: "POST" | "PATCH", path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  if (!supabaseReady()) return
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.log(`Sentiment Guide bg: Supabase ${method} ${path} failed —`, res.status)
  } catch (err) {
    console.log("Sentiment Guide bg: Supabase error —", (err as Error).message)
  }
}

export interface ToneEvent {
  id: string
  contact_hash: string | null
  tone: "yellow" | "red"
  confidence: number
  label: string
  flagged_phrase: string
  suggestion: string
  tone_tags_detected: boolean
}

export async function logEvent(event: ToneEvent) {
  await sbRequest("POST", "events", { ...event, child_id: await getChildId(), suggestion_accepted: null })
}

export async function logAcceptance(eventId: string, accepted: boolean) {
  await sbRequest("PATCH", `events?id=eq.${encodeURIComponent(eventId)}`, { suggestion_accepted: accepted })
}

export async function logContext(context: ChatContext, contactHash: string) {
  await sbRequest("POST", "context_forms?on_conflict=child_id,contact_hash", {
    child_id:                 await getChildId(),
    contact_hash:             contactHash,
    platform:                 context.platform,
    relationship:             context.q1,
    communication_style:      context.q2,
    child_uses_tone_tags:     context.q3,
    recipient_uses_tone_tags: context.q4,
    conversation_mood:        context.q5,
    saved_at:                 new Date(context.savedAt).toISOString(),
  }, { Prefer: "resolution=merge-duplicates" })
}
