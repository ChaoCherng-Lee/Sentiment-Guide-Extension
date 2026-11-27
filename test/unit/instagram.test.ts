// Checks the Instagram adapter's selectors against every saved page in
// test/fixtures/instagram/, so a change in Instagram's page shows up here.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { instagram, sentByMe } from "../../src/platforms/instagram"
import type { IncomingMessage } from "../../src/platforms/types"

const DIR = path.resolve("test/fixtures/instagram")
const pages = readdirSync(DIR).filter(f => f.endsWith(".html"))

function load(file: string) {
  const html = readFileSync(path.join(DIR, file), "utf8")
  document.body.innerHTML = html
  history.pushState({}, "", "/direct/t/340282366841710300949128/")
  const expect = (name: string) => html.match(new RegExp(`EXPECT ${name}: (.*)`))?.[1].trim() ?? ""
  return { title: expect("title"), recent: expect("recent") }
}

afterEach(() => {
  document.body.innerHTML = ""
  history.pushState({}, "", "/")
})

describe.each(pages)("instagram adapter on %s", (file) => {
  it("finds the message box only inside a DM thread", () => {
    load(file)
    expect(instagram.findComposeBoxes()).toHaveLength(1)
    expect(instagram.findComposeBoxes()[0].getAttribute("aria-label")).toBe("Message")
    history.pushState({}, "", "/explore/")
    expect(instagram.findComposeBoxes()).toEqual([])
  })

  it("takes the conversation ID from the URL and the title from the header", () => {
    const want = load(file)
    const id = instagram.getConversationId()
    expect(id).toBeTruthy()
    history.pushState({}, "", "/direct/t/999/")
    expect(instagram.getConversationId()).not.toBe(id)
    expect(instagram.getConversationTitle()).toBe(want.title)
  })

  it("reads text messages with who sent them, skipping photos, times and labels", () => {
    const want = load(file)
    const got = instagram.getRecentMessages(10).map(m => `${m.from}:${m.text}`).join(" | ")
    expect(got).toBe(want.recent)
  })

  it("reports the latest incoming messages", () => {
    const want = load(file)
    const seen: IncomingMessage[] = []
    instagram.observeIncoming(m => seen.push(m))()
    const them = want.recent.split(" | ").filter(s => s.startsWith("them:")).map(s => s.slice(5))
    expect(seen.map(m => m.text)).toEqual(them.slice(-3))
  })
})

describe("sentByMe without labels", () => {
  it("uses which side of the conversation the bubble is on", () => {
    document.body.innerHTML = `<div id="conv"><div role="row" id="l"><div dir="auto">left</div></div><div role="row" id="r"><div dir="auto">right</div></div></div>`
    const rect = (left: number, width: number) => () => ({ left, width, top: 0, height: 10, right: left + width, bottom: 10, x: left, y: 0, toJSON() {} }) as DOMRect
    const conv = document.getElementById("conv")!
    conv.getBoundingClientRect = rect(0, 600)
    document.querySelector<HTMLElement>("#l [dir]")!.getBoundingClientRect = rect(20, 150)
    document.querySelector<HTMLElement>("#r [dir]")!.getBoundingClientRect = rect(420, 150)
    expect(sentByMe(document.getElementById("l")!, conv)).toBe(false)
    expect(sentByMe(document.getElementById("r")!, conv)).toBe(true)
  })
})
