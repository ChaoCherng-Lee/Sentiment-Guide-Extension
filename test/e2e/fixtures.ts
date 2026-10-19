import { type BrowserContext, type Page, type Worker, test as base, chromium } from "@playwright/test"
import path from "node:path"
import { OPTIONAL_SITES } from "../../src/platforms/sites"

const EXTENSION = path.resolve(".output/chrome-mv3")
const FIXTURES  = path.resolve("test/fixtures")

/** Sites the extension runs on, served from local fixture pages. */
const SITES: Record<string, string> = {
  "https://web.whatsapp.com/**": "whatsapp.html",
  "https://www.instagram.com/**": "instagram.html",
  "https://mail.google.com/**": "gmail.html",
}

export const HARSH = "you are so stupid, just shut up already"

/** Launch Chromium with the built extension. `userDataDir` "" = throwaway profile. */
export async function launch(userDataDir = ""): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  })
  for (const [pattern, file] of Object.entries(SITES)) {
    await context.route(pattern, route => route.fulfill({ path: path.join(FIXTURES, file) }))
  }
  return context
}

export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent("serviceworker")
  if (process.env.SG_DEBUG) worker.on("console", m => console.log("[background]", m.text()))
  return worker
}

/**
 * Wait until the background worker has registered the optional sites'
 * content scripts (the e2e build starts with them allowed).
 */
export async function sitesReady(worker: Worker) {
  await expect.poll(() => worker.evaluate(async () => {
    const g = globalThis as unknown as { chrome: typeof import("wxt/browser").browser }
    return (await g.chrome.scripting.getRegisteredContentScripts()).map(s => s.id).sort().join(",")
  })).toBe(OPTIONAL_SITES.map(s => s.id).sort().join(","))
}

/** Open the WhatsApp fixture and skip the first-visit context form. */
export async function openWhatsApp(page: Page) {
  await page.goto("https://web.whatsapp.com/")
  const form = page.locator("#sg-context-host")
  await form.locator("#skip").click({ timeout: 15_000 })
  await expect(form).toHaveCount(0)
}

/** Start counting model calls made by the background worker. */
export async function countModelCalls(worker: Worker) {
  await worker.evaluate(() => {
    const g = globalThis as unknown as { fetch: typeof fetch; __modelCalls: number }
    const original = g.fetch
    g.__modelCalls = 0
    g.fetch = (input, init) => {
      if (String(input).includes("/api/chat")) g.__modelCalls++
      return original(input, init)
    }
  })
  return () => worker.evaluate(() => (globalThis as unknown as { __modelCalls: number }).__modelCalls)
}

/** Start recording what the background worker sends to the model; returns the user turns sent so far. */
export async function recordModelRequests(worker: Worker) {
  await worker.evaluate(() => {
    const g = globalThis as unknown as { fetch: typeof fetch; __userTurns: string[] }
    const original = g.fetch
    g.__userTurns = []
    g.fetch = (input, init) => {
      if (String(input).includes("/api/chat") && typeof init?.body === "string") {
        const { messages } = JSON.parse(init.body) as { messages: { role: string; content: string }[] }
        g.__userTurns.push(messages.filter(m => m.role === "user").map(m => m.content).join("\n"))
      }
      return original(input, init)
    }
  })
  return () => worker.evaluate(() => (globalThis as unknown as { __userTurns: string[] }).__userTurns)
}

/**
 * A stand-in for Ollama inside the background worker, so tests about the
 * extension's behaviour don't wait on the real model (each real check takes
 * ~7 s). It answers from a few rules: messages with an insult are flagged,
 * the rewrite depends on the style, and sarcastic-looking received messages
 * get a hedged reading. How good the real model's judgement is, is the eval's
 * job (eval/), not these tests'. Tests that need the real model use
 * `test.use({ realModel: true })`.
 */
export async function fakeModel(worker: Worker) {
  await worker.evaluate(() => {
    const g = globalThis as unknown as { fetch: typeof fetch }
    const original = g.fetch
    const FLAGS = ["stupid", "idiot", "useless", "annoying", "clown", "shut up"]
    const SOFTER: Record<string, string> = {
      "stupid": "frustrating", "idiot": "wrong about this", "useless": "not helping right now",
      "annoying": "a lot right now", "clown": "being silly", "shut up": "give me a minute",
    }
    const REWRITES: Record<string, string> = {
      casual: "hey I'm really annoyed rn, can we talk later?",
      formal: "I am quite frustrated at the moment. Could we talk about this later?",
      direct: "I'm frustrated. Let's talk later.",
    }
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
    /** The last fenced block of the last user turn: the message being judged. */
    const judged = (messages: { role: string; content: string }[]) => {
      const user = messages.filter(m => m.role === "user").at(-1)?.content ?? ""
      return [...user.matchAll(/"""\n([\s\S]*?)\n"""/g)].at(-1)?.[1] ?? ""
    }

    g.fetch = async (input, init) => {
      const url = String(input)
      if (!url.startsWith("http://127.0.0.1:11434")) return original(input, init)
      const path = new URL(url).pathname
      if (path === "/api/tags") return json({ models: [{ name: "gemma3:4b" }] })
      if (path === "/api/ps")   return json({ models: [{ name: "gemma3:4b" }] })

      const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[]; format?: { properties?: Record<string, unknown> } }
      if (!body.messages?.length) return json({})   // warm-up
      // A short wait, so cancelling and queueing still happen as they would
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 200)
        init?.signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")) })
      })

      const text  = judged(body.messages)
      const lower = text.toLowerCase()
      const found = FLAGS.filter(f => lower.includes(f))
      const props = body.format?.properties ?? {}
      let reply: unknown
      if ("tone" in props) {
        const at = found.length ? lower.indexOf(found[0]) : -1
        reply = found.length
          ? { tone: "red", confidence: 0.9, flagged_phrase: text.slice(at, at + found[0].length), tone_tags_detected: false }
          : { tone: "green", confidence: 0.9, flagged_phrase: "", tone_tags_detected: false }
      } else if ("label" in props) {
        const system = body.messages.find(m => m.role === "system")?.content ?? ""
        const style  = /Suggestion style: (\w+)/.exec(system)?.[1].toLowerCase() ?? "casual"
        reply = {
          label: "Insult", category: "insult",
          explanation: "Calling someone names can really hurt, even when you're upset.",
          suggestion: REWRITES[style] ?? REWRITES.casual,
          edits: found.map(f => ({ original: f, replacement: SOFTER[f], reason: "Says how you feel without the insult." })),
          emoji_notes: text.includes("🙄") ? [{ emoji: "🙄", reading: "Can read as an eye-roll." }] : [],
        }
      } else if ("reading" in props) {
        reply = /🙄|ditching|whatever|ugh/i.test(text)
          ? { reading: "sarcastic", confidence: 0.7, explanation: "This might be sarcastic." }
          : { reading: "neutral", confidence: 0.8, explanation: "Seems like an ordinary message." }
      } else {
        return original(input, init)
      }
      return json({ message: { role: "assistant", content: JSON.stringify(reply) } })
    }
  })
}

export const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string; realModel: boolean }>({
  realModel: [false, { option: true }],
  context: async ({}, use) => {
    const context = await launch()
    await use(context)
    await context.close()
  },
  worker: async ({ context, realModel }, use) => {
    const worker = await backgroundWorker(context)
    if (!realModel) await fakeModel(worker)
    await use(worker)
  },
  // Every test gets the worker (and so the stand-in model), even if it doesn't ask for it
  page: async ({ context, worker: _ }, use) => {
    await use(await context.newPage())
  },
  extensionId: async ({ worker }, use) => {
    await use(worker.url().split("/")[2])
  },
})

export const expect = test.expect
