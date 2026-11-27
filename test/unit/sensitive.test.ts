import { describe, expect, it } from "vitest"
import { isSensitiveField, isSensitiveSite } from "../../src/platforms/sensitive"
import { DEFAULT_SETTINGS, isSiteDisabled } from "../../src/settings/store"

const field = (html: string) => {
  document.body.innerHTML = html
  return document.querySelector<HTMLElement>("[data-t]")!
}

describe("sensitive fields", () => {
  it("skips card, code, password and address boxes, and boxes in a login form", () => {
    expect(isSensitiveField(field('<textarea data-t autocomplete="cc-number"></textarea>'))).toBe(true)
    expect(isSensitiveField(field('<textarea data-t autocomplete="shipping street-address"></textarea>'))).toBe(true)
    expect(isSensitiveField(field('<textarea data-t autocomplete="one-time-code"></textarea>'))).toBe(true)
    expect(isSensitiveField(field('<div data-t contenteditable aria-label="Billing address"></div>'))).toBe(true)
    expect(isSensitiveField(field('<textarea data-t name="cvv"></textarea>'))).toBe(true)
    expect(isSensitiveField(field('<form><input type="password"><textarea data-t></textarea></form>'))).toBe(true)
  })

  it("checks ordinary boxes", () => {
    expect(isSensitiveField(field('<textarea data-t placeholder="Write a comment"></textarea>'))).toBe(false)
    expect(isSensitiveField(field('<form><input name="q"><textarea data-t></textarea></form>'))).toBe(false)
    expect(isSensitiveField(field('<textarea data-t autocomplete="off"></textarea>'))).toBe(false)
  })
})

describe("sensitive sites", () => {
  it("knows banks, health and government", () => {
    for (const h of ["www.irs.gov", "www.gov.uk", "impots.gouv.fr", "online.chase.com", "www.examplebank.com", "mychart.org", "www.nhs.uk", "my.health.example"]) {
      expect(isSensitiveSite(h), h).toBe(true)
    }
    for (const h of ["www.reddit.com", "github.com", "bankofmemes.example".replace("bank", "blank"), "governance.dev", "web.whatsapp.com"]) {
      expect(isSensitiveSite(h), h).toBe(false)
    }
  })

  it("are off until turned on, and stay switchable", () => {
    expect(isSiteDisabled(DEFAULT_SETTINGS, "www.examplebank.com")).toBe(true)
    expect(isSiteDisabled({ ...DEFAULT_SETTINGS, enabledSites: ["www.examplebank.com"] }, "www.examplebank.com")).toBe(false)
    expect(isSiteDisabled(DEFAULT_SETTINGS, "www.reddit.com")).toBe(false)
  })
})
