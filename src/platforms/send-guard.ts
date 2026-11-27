// Holding a send (Plan 10.1): the moment before a message goes is where a
// pause helps most (Twitter's and Instagram's "are you sure?" prompts).
//
// For chat-style boxes: Enter (without Shift) or the send button. Listens on
// the window in the capture phase, so it runs before the site's own handlers
// and can stop them. A send the guard doesn't hold is left completely alone.
// Ctrl/⌘+Enter is never held: it's "send anyway" from the keyboard.

/** What the compose session says about a send: go, hold, or wait for a check. */
export type SendDecision = boolean | Promise<boolean>

export interface ChatSendTarget {
  /** The send button for this box, if the site has one */
  sendButton?: () => HTMLElement | null
  /** For boxes in a <form> without a button: submit it */
  form?: () => HTMLFormElement | null
  /** Enter sends (chat apps). False for boxes where Enter is a new line. Default true. */
  enterSends?: boolean
}

const passes = new WeakMap<HTMLElement, () => void>()

export function guardChatSend(box: HTMLElement, target: ChatSendTarget, check: () => SendDecision): () => void {
  let letThrough = false
  let waiting = false

  const decide = (e: Event) => {
    if (letThrough) return
    if (waiting) { e.preventDefault(); e.stopImmediatePropagation(); return }
    const decision = check()
    if (decision === true) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (decision === false) return
    waiting = true
    decision.then(ok => { if (ok) sendChatNow(box, target) }).finally(() => { waiting = false })
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || target.enterSends === false) return
    if (e.target !== box && !box.contains(e.target as Node)) return
    if (e.ctrlKey || e.metaKey) {
      // Send anyway, from the keyboard: sites that send on plain Enter need it
      if (letThrough) return
      e.preventDefault()
      e.stopImmediatePropagation()
      sendChatNow(box, target)
      return
    }
    decide(e)
  }
  const onPointer = (e: MouseEvent) => {
    const btn = target.sendButton?.()
    if (!btn || !(e.target instanceof Node) || !btn.contains(e.target)) return
    if (e.type === "click") decide(e)
    else if (!letThrough && waiting) { e.preventDefault(); e.stopImmediatePropagation() }
  }
  const onSubmit = (e: SubmitEvent) => {
    if (e.target !== target.form?.()) return
    decide(e)
  }

  window.addEventListener("keydown", onKey, true)
  window.addEventListener("click", onPointer, true)
  window.addEventListener("submit", onSubmit, true)
  passes.set(box, () => {
    letThrough = true
    setTimeout(() => { letThrough = false }, 0)
  })
  return () => {
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("click", onPointer, true)
    window.removeEventListener("submit", onSubmit, true)
    passes.delete(box)
  }
}

/** Send past the guard: the button if there is one, else the form, else Enter. */
export function sendChatNow(box: HTMLElement, target: ChatSendTarget) {
  passes.get(box)?.()
  const btn = target.sendButton?.()
  if (btn) { btn.click(); return }
  const form = target.form?.()
  if (form) { form.requestSubmit(); return }
  box.focus()
  for (const type of ["keydown", "keypress", "keyup"]) {
    box.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  }
}
