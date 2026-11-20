// Chrome's built-in AI from the background worker. Workers may not have the
// Prompt API, so when this one doesn't, the model runs in a hidden
// "offscreen" extension page (entrypoints/offscreen) and the two talk by
// message. Both sides are in this file so the message shapes stay in step.

import { browser } from "#imports"
import { type Availability, type LanguageModelHost, directHost, languageModelHere } from "./builtin"
import type { ChatTurn } from "./prompts"

export type OffscreenRequest =
  | { target: "offscreen"; op: "availability" }
  | { target: "offscreen"; op: "warm" }
  | { target: "offscreen"; op: "prompt"; id: string; initial: ChatTurn[]; input: string; schema: object }
  | { target: "offscreen"; op: "abort"; id: string }

type OffscreenReply = { ok: true; value: unknown } | { ok: false; name: string; message: string }

const OFFSCREEN_URL = "/offscreen.html"
let creating: Promise<void> | null = null

async function ensureDocument() {
  const offscreen = browser.offscreen
  if (await offscreen.hasDocument()) return
  creating ??= offscreen.createDocument({
    url: OFFSCREEN_URL,
    // There is no reason for "run an on-device model"; WORKERS is the
    // closest: the page does work the service worker can't
    reasons: ["WORKERS"],
    justification: "Runs Chrome's built-in AI model, which service workers can't use, to check the tone of messages on this computer.",
  }).finally(() => { creating = null })
  await creating
}

async function ask(req: OffscreenRequest): Promise<unknown> {
  await ensureDocument()
  const reply = await browser.runtime.sendMessage(req) as OffscreenReply | undefined
  if (!reply) throw Object.assign(new Error("The built-in AI page didn't answer"), { name: "NotSupportedError" })
  if (!reply.ok) throw Object.assign(new Error(reply.message), { name: reply.name })
  return reply.value
}

/** The model in this context if it has the Prompt API, else in the offscreen page. */
export function backgroundHost(): LanguageModelHost {
  const here = languageModelHere()
  if (here) return directHost(here)
  return {
    availability: () => ask({ target: "offscreen", op: "availability" }) as Promise<Availability | "missing">,
    warm: async () => { await ask({ target: "offscreen", op: "warm" }) },
    async prompt(initial, input, schema, signal) {
      const id = crypto.randomUUID()
      const onAbort = () => { ask({ target: "offscreen", op: "abort", id }).catch(() => {}) }
      signal.addEventListener("abort", onAbort)
      try {
        return await Promise.race([
          ask({ target: "offscreen", op: "prompt", id, initial, input, schema }) as Promise<string>,
          new Promise<never>((_, reject) => {
            const fail = () => reject(signal.reason)
            if (signal.aborted) fail()
            signal.addEventListener("abort", fail)
          }),
        ])
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
    },
  }
}

/** The offscreen page's side: answers the background worker. */
export function serveOffscreen() {
  const lm = languageModelHere()
  const host = lm ? directHost(lm) : null
  const running = new Map<string, AbortController>()

  browser.runtime.onMessage.addListener((msg: OffscreenRequest, sender, sendResponse) => {
    if (msg?.target !== "offscreen" || sender.id !== browser.runtime.id) return
    const reply = (p: Promise<unknown>) => {
      p.then(value => sendResponse({ ok: true, value } satisfies OffscreenReply),
        (err: Error) => sendResponse({ ok: false, name: err?.name ?? "Error", message: err?.message ?? String(err) } satisfies OffscreenReply))
      return true
    }
    switch (msg.op) {
      case "availability":
        return reply(host ? host.availability() : Promise.resolve("missing"))
      case "warm":
        return reply(host ? host.warm() : Promise.resolve())
      case "prompt": {
        if (!host) return reply(Promise.reject(Object.assign(new Error("no built-in AI"), { name: "NotSupportedError" })))
        const ctrl = new AbortController()
        running.set(msg.id, ctrl)
        return reply(host.prompt(msg.initial, msg.input, msg.schema, ctrl.signal).finally(() => running.delete(msg.id)))
      }
      case "abort":
        running.get(msg.id)?.abort()
        return reply(Promise.resolve())
    }
  })
}
