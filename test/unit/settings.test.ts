import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SETTINGS, getChatData, getSettings, subscribeSettings, updateChatData, updateSettings,
} from "../../src/settings/store"

describe("settings store", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it("merges updates over stored values", async () => {
    await updateSettings({ model: "gemma3:1b" })
    expect((await getSettings()).model).toBe("gemma3:1b")
  })

  it("notifies subscribers with the full settings until unsubscribed", async () => {
    const cb = vi.fn()
    const unsubscribe = subscribeSettings(cb)
    await updateSettings({ model: "x" })
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, model: "x" }))
    unsubscribe()
    await updateSettings({ model: "y" })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("keeps per-chat data separate per chat", async () => {
    await updateChatData("abc", {
      context: { platform: "whatsapp", q1: "family", q2: "friendly", q3: "no", q4: "no", q5: "normal", savedAt: 1 },
    })
    expect((await getChatData("abc")).context?.q1).toBe("family")
    expect(await getChatData("other")).toEqual({})
  })
})
