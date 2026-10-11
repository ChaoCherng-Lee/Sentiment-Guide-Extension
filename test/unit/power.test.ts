import { describe, expect, it } from "vitest"
import {
  DEFAULT_SETTINGS, MAX_DISABLED_CONVERSATIONS, getSettings, isActive, isConversationDisabled,
  pauseUntil, resolveStyle, resume, setConversationDisabled, setEnabled, tomorrowMorning, updateSettings,
} from "../../src/settings/store"

const NOW = new Date("2026-10-12T15:30:00").getTime()

describe("isActive", () => {
  it("is on by default", () => {
    expect(isActive(DEFAULT_SETTINGS, NOW)).toBe(true)
  })

  it("is off when disabled", () => {
    expect(isActive({ ...DEFAULT_SETTINGS, enabled: false }, NOW)).toBe(false)
  })

  it("is off while paused and back on once the pause ends", () => {
    const s = { ...DEFAULT_SETTINGS, pausedUntil: NOW + 1000 }
    expect(isActive(s, NOW)).toBe(false)
    expect(isActive(s, NOW + 1000)).toBe(true)
  })
})

describe("pause controls", () => {
  it("pausing turns the extension on and sets the end time", async () => {
    await setEnabled(false)
    await pauseUntil(NOW + 5000)
    expect(await getSettings()).toMatchObject({ enabled: true, pausedUntil: NOW + 5000 })
  })

  it("resume and switching on/off clear the pause", async () => {
    await pauseUntil(NOW + 5000)
    await resume()
    expect((await getSettings()).pausedUntil).toBeNull()
    await pauseUntil(NOW + 5000)
    await setEnabled(false)
    expect(await getSettings()).toMatchObject({ enabled: false, pausedUntil: null })
  })

  it("'until tomorrow' means 7 am the next day", () => {
    const t = new Date(tomorrowMorning(new Date(NOW)))
    expect(t.getDate()).toBe(13)
    expect(t.getHours()).toBe(7)
    expect(t.getMinutes()).toBe(0)
  })
})

describe("resolveStyle", () => {
  const formalCtx = { platform: "gmail", q1: "teacher", q2: "formal", q3: "no", q4: "no", q5: "normal", savedAt: 0 } as const

  it("uses the default style", () => {
    expect(resolveStyle({ ...DEFAULT_SETTINGS, suggestionStyle: "direct" }, {})).toBe("direct")
  })

  it("pre-selects Formal for a chat the context form calls formal", () => {
    expect(resolveStyle(DEFAULT_SETTINGS, { context: formalCtx })).toBe("formal")
  })

  it("prefers the style picked for the chat over everything else", () => {
    expect(resolveStyle(DEFAULT_SETTINGS, { context: formalCtx, style: "casual" })).toBe("casual")
  })
})

describe("per-chat switch", () => {
  it("turns one chat off and on again", async () => {
    await setConversationDisabled("chatA", true)
    let s = await getSettings()
    expect(isConversationDisabled(s, "chatA")).toBe(true)
    expect(isConversationDisabled(s, "chatB")).toBe(false)
    expect(isConversationDisabled(s, null)).toBe(false)

    await setConversationDisabled("chatA", false)
    s = await getSettings()
    expect(isConversationDisabled(s, "chatA")).toBe(false)
  })

  it("doesn't add the same chat twice", async () => {
    await setConversationDisabled("chatA", true)
    await setConversationDisabled("chatA", true)
    expect((await getSettings()).disabledConversations).toEqual(["chatA"])
  })

  it("keeps only the newest chats when the list is full", async () => {
    const many = Array.from({ length: MAX_DISABLED_CONVERSATIONS }, (_, i) => "old" + i)
    await updateSettings({ disabledConversations: many })
    await setConversationDisabled("new", true)
    const list = (await getSettings()).disabledConversations
    expect(list).toHaveLength(MAX_DISABLED_CONVERSATIONS)
    expect(list).not.toContain("old0")
    expect(list.at(-1)).toBe("new")
  })
})
