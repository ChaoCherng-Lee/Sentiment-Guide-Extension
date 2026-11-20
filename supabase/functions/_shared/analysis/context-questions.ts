// GENERATED from src/analysis by scripts/sync-function.mjs — edit the original, then run npm run sync:function

// The per-chat context questions. Shared by the context form (labels for the
// chips) and the prompt builder (labels sent to the model).

export interface Question {
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

export function answerLabel(id: Question["id"], value: string | undefined): string {
  const q = QUESTIONS.find(q => q.id === id)
  return q?.options.find(o => o.value === value)?.label ?? value ?? "unknown"
}
