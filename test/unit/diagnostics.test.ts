import { describe, expect, it } from "vitest"
import { counterNames, flushDiag, pendingDiag, recordDiag, siteKind } from "../../src/diagnostics"

describe("diagnostics", () => {
  it("names only fixed words: no text, no sites", () => {
    expect(counterNames({ kind: "check", backend: "cloud", ms: 640 })).toEqual(["check.cloud", "latency.1000"])
    expect(counterNames({ kind: "check", backend: "ollama", ms: 9000 })).toEqual(["check.ollama", "latency.more"])
    expect(counterNames({ kind: "flag", tone: "red", site: siteKind("discord.com") })).toEqual(["flag.red.web"])
    expect(counterNames({ kind: "flag", tone: "yellow", site: siteKind("whatsapp") })).toEqual(["flag.yellow.chat"])
    expect(counterNames({ kind: "fine", reason: null })).toEqual(["fine.none"])
    expect(counterNames({ kind: "failure", reason: "you are so stupid!" })).toEqual(["failure.youaresostupid"])
  })

  it("adds up a day, and sends only finished days", async () => {
    await recordDiag({ kind: "accepted" })
    await recordDiag({ kind: "accepted" })
    const [today] = await pendingDiag()
    expect(today.counts).toEqual({ accepted: 2 })

    const sent: string[] = []
    await flushDiag(async d => { sent.push(d.day); return true })
    expect(sent).toEqual([])     // today is still counting
    expect(await pendingDiag()).toHaveLength(1)
  })
})
