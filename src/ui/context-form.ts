// =============================================================================
// Context form — slide-up card with chip selectors, shown once per chat so the
// model can calibrate to the relationship and conversation mood.
// Lives in a Shadow DOM host so styles never leak into the page.
// =============================================================================

import type { ChatContext, Platform } from "../analysis/types"

interface Question {
  id: "q1" | "q2" | "q3" | "q4" | "q5"
  label: string
  options: { value: string; label: string }[]
}

export const QUESTIONS: Question[] = [
  {
    id: "q1",
    label: "Who is this person to you?",
    options: [
      { value: "close_friend", label: "Close friend" },
      { value: "classmate",    label: "Classmate / acquaintance" },
      { value: "family",       label: "Family member" },
      { value: "teacher",      label: "Teacher / coach" },
      { value: "romantic",     label: "Romantic interest" },
      { value: "new_person",   label: "Someone I just met" },
    ],
  },
  {
    id: "q2",
    label: "How do you usually talk to them?",
    options: [
      { value: "very_casual", label: "Very casual — we joke and tease" },
      { value: "friendly",    label: "Friendly but normal" },
      { value: "polite",      label: "Mostly polite and careful" },
      { value: "formal",      label: "Formal — like emails to a teacher" },
    ],
  },
  {
    id: "q3",
    label: "Do YOU use tone tags? (/j /s /srs)",
    options: [
      { value: "yes",       label: "Yes I use them" },
      { value: "sometimes", label: "Sometimes" },
      { value: "no",        label: "No I don't" },
    ],
  },
  {
    id: "q4",
    label: "Does the OTHER PERSON use tone tags?",
    options: [
      { value: "yes",       label: "Yes they do" },
      { value: "sometimes", label: "Sometimes" },
      { value: "no",        label: "No they don't" },
      { value: "not_sure",  label: "Not sure" },
    ],
  },
  {
    id: "q5",
    label: "What's the current mood of the conversation?",
    options: [
      { value: "normal",     label: "Normal, nothing unusual" },
      { value: "frustrated", label: "I'm a bit frustrated or upset" },
      { value: "tense",      label: "We've been arguing or it's tense" },
      { value: "responding", label: "Something happened and I'm responding to it" },
    ],
  },
]

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  whatsapp: "WhatsApp",
  gmail: "Gmail",
  outlook: "Outlook",
}
const PLATFORM_ORDER = Object.keys(PLATFORM_LABELS) as Platform[]

const STYLES = `
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
`

let openHost: HTMLElement | null = null

/**
 * Show the context form for a chat. `onSave` receives the answers; closing or
 * skipping saves nothing. Opening a new form replaces any open one.
 */
export function showContextForm(
  contactName: string,
  platform: Platform,
  onSave: (ctx: ChatContext) => void,
) {
  openHost?.remove()
  let currentPlatform = platform

  // No user data interpolated here — all hardcoded labels
  const questionsHTML = QUESTIONS.map(q =>
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
    <style>${STYLES}</style>
    <div class="form-card" id="card" role="dialog" aria-label="Chat context">
      <div class="form-header">
        <div>
          <div class="form-title" id="title"></div>
          <div class="form-subtitle">Helps me give better feedback on your tone</div>
        </div>
        <button class="close-btn" id="close" aria-label="Close">×</button>
      </div>
      <div class="platform-row">
        <span class="platform-label">Platform</span>
        <button class="platform-chip" id="platform"></button>
      </div>
      <div class="questions">${questionsHTML}</div>
      <div class="form-actions">
        <button class="btn-save" id="save" disabled>Save context</button>
        <button class="btn-skip" id="skip">Skip for now</button>
      </div>
    </div>
  `
  const $ = (id: string) => s.getElementById(id) as HTMLElement

  // Contact name set via textContent, never innerHTML
  $("title").textContent = `Quick context — ${contactName}`

  const platformChip = $("platform")
  platformChip.textContent = PLATFORM_LABELS[currentPlatform] ?? "WhatsApp"
  platformChip.addEventListener("click", () => {
    const idx = PLATFORM_ORDER.indexOf(currentPlatform)
    currentPlatform = PLATFORM_ORDER[(idx + 1) % PLATFORM_ORDER.length]
    platformChip.textContent = PLATFORM_LABELS[currentPlatform]!
  })

  // Chip selection — single-select per question
  const answers: Partial<Record<Question["id"], string>> = {}
  s.querySelectorAll<HTMLButtonElement>(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const qId = chip.dataset.q as Question["id"]
      s.querySelectorAll(`.chip[data-q="${qId}"]`).forEach(c => c.classList.remove("selected"))
      chip.classList.add("selected")
      answers[qId] = chip.dataset.value
      ;($("save") as HTMLButtonElement).disabled = !QUESTIONS.every(q => answers[q.id])
    })
  })

  function dismiss(save: boolean) {
    $("card").classList.remove("visible")
    setTimeout(() => {
      host.remove()
      if (openHost === host) openHost = null
    }, 380)
    if (save) {
      onSave({
        platform: currentPlatform,
        q1: answers.q1!, q2: answers.q2!, q3: answers.q3!,
        q4: answers.q4!, q5: answers.q5!,
        savedAt: Date.now(),
      })
    }
  }

  $("close").addEventListener("click", () => dismiss(false))
  $("skip").addEventListener("click",  () => dismiss(false))
  $("save").addEventListener("click",  () => dismiss(true))

  document.body.appendChild(host)
  openHost = host

  // Two rAF passes ensure the element is painted before the transition starts
  requestAnimationFrame(() => requestAnimationFrame(() => $("card").classList.add("visible")))
}
