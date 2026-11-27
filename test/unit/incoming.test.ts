import { afterEach, describe, expect, it, vi } from "vitest"
import { worthABadge } from "../../src/analysis/incoming"
import { buildIncomingMessages, buildVerdictMessages } from "../../src/analysis/prompts"
import { validateIncoming } from "../../src/analysis/schema"
import type { IncomingMessage } from "../../src/platforms/types"
import { whatsapp } from "../../src/platforms/whatsapp"
import { getIncomingFeedback, recordIncomingFeedback } from "../../src/settings/store"

describe("validateIncoming", () => {
  it("keeps a valid reading", () => {
    expect(validateIncoming({ reading: "teasing", confidence: 0.8, explanation: "They're probably joking." }))
      .toEqual({ reading: "teasing", confidence: 0.8, explanation: "They're probably joking." })
  })

  it("turns unknown readings into unclear and clamps confidence", () => {
    expect(validateIncoming({ reading: "furious", confidence: 7, explanation: "" }))
      .toMatchObject({ reading: "unclear", confidence: 1 })
    expect(validateIncoming(null)).toMatchObject({ reading: "unclear", confidence: 0.5, explanation: "" })
  })

  it("hedges an explanation that states feelings as fact", () => {
    expect(validateIncoming({ reading: "angry", confidence: 0.9, explanation: "They are angry at you." }).explanation)
      .toBe("Hard to say for sure, but they are angry at you.")
    expect(validateIncoming({ reading: "angry", confidence: 0.9, explanation: "They might be annoyed." }).explanation)
      .toBe("They might be annoyed.")
  })
})

describe("worthABadge", () => {
  it("skips friendly and neutral readings", () => {
    expect(worthABadge("friendly")).toBe(false)
    expect(worthABadge("neutral")).toBe(false)
    for (const r of ["teasing", "sarcastic", "upset", "angry", "unclear"] as const) expect(worthABadge(r)).toBe(true)
  })
})

describe("buildIncomingMessages", () => {
  it("has its own fixed system message that asks for hedging, and fences the message", () => {
    const [system, user] = buildIncomingMessages("ok.")
    expect(system.content).toBe(buildIncomingMessages("something else 🙄")[0].content)
    expect(system.content).not.toBe(buildVerdictMessages("ok.", null)[0].content)
    expect(system.content).toContain("Always hedge")
    expect(user.content).toContain('Message they received:\n"""\nok.\n"""')
  })

  it("adds tone tags and emoji readings", () => {
    const [, user] = buildIncomingMessages("you're the worst /j 🙄")
    expect(user.content).toContain("/j = joking")
    expect(user.content).toContain("🙄 (can sound negative)")
  })
})

describe("whatsapp.observeIncoming", () => {
  const bubble = (from: "in" | "out", text: string, time: string) =>
    `<div class="message-${from}"><div class="copyable-text" data-pre-plain-text="[${time}, 19/10/2026] Alex: "><span class="selectable-text"><span>${text}</span></span></div></div>`

  let stop: (() => void) | undefined
  afterEach(() => { stop?.(); document.body.innerHTML = "" })

  it("reports only the last 3 incoming messages when a chat opens, then new ones", async () => {
    document.body.innerHTML = `<div id="main">${[1, 2, 3, 4, 5].map(i => bubble("in", `old ${i}`, `10:0${i}`)).join("")}${bubble("out", "mine", "10:06")}</div>`
    const seen: IncomingMessage[] = []
    stop = whatsapp.observeIncoming(m => seen.push(m))
    expect(seen.map(m => m.text)).toEqual(["old 3", "old 4", "old 5"])

    document.getElementById("main")!.insertAdjacentHTML("beforeend", bubble("in", "new one", "10:07"))
    document.getElementById("main")!.insertAdjacentHTML("beforeend", bubble("out", "my reply", "10:08"))
    await vi.waitFor(() => expect(seen.map(m => m.text)).toEqual(["old 3", "old 4", "old 5", "new one"]))
  })

  it("never reports older messages loaded above", async () => {
    document.body.innerHTML = `<div id="main">${bubble("in", "latest", "10:05")}</div>`
    const seen: string[] = []
    stop = whatsapp.observeIncoming(m => seen.push(m.text))
    document.getElementById("main")!.insertAdjacentHTML("afterbegin", bubble("in", "older", "09:00").repeat(3))
    await new Promise(r => setTimeout(r, 400))
    expect(seen).toEqual(["latest"])
  })

  it("keys a message by its time and text, so a redrawn bubble keeps its key", () => {
    document.body.innerHTML = `<div id="main">${bubble("in", "hi", "10:01")}</div>`
    const keys: string[] = []
    stop = whatsapp.observeIncoming(m => keys.push(m.key))
    stop()
    document.body.innerHTML = `<div id="main">${bubble("in", "hi", "10:01")}${bubble("in", "hi", "10:02")}</div>`
    stop = whatsapp.observeIncoming(m => keys.push(m.key))
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })
})

describe("incoming feedback", () => {
  it("counts helpful / not helpful per reading, with no text", async () => {
    await recordIncomingFeedback("teasing", true)
    await recordIncomingFeedback("teasing", false)
    await recordIncomingFeedback("teasing", true)
    expect(await getIncomingFeedback()).toEqual({ teasing: { helpful: 2, notHelpful: 1 } })
  })
})
