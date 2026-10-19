// Sites the user switches on one by one (Plan Phase 4). Each needs an
// optional host permission, granted from the options page; the background
// worker registers the site's content script only while it is granted.
// WhatsApp is always on and is not listed here.

export interface OptionalSite {
  id: "instagram" | "gmail"
  name: string
  description: string
  /** Host permission patterns; also the content script's matches */
  origins: string[]
  /** Built content script, as WXT names it */
  script: string
}

export const OPTIONAL_SITES: OptionalSite[] = [
  {
    id: "instagram",
    name: "Instagram DMs",
    description: "Checks messages you write in Instagram direct messages (instagram.com/direct).",
    // The whole site, not just /direct: Instagram changes page without reloading
    origins: ["https://www.instagram.com/*"],
    script: "content-scripts/instagram.js",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Checks emails you write in Gmail: the paragraph you're writing as you go, and the whole email when you press Send.",
    origins: ["https://mail.google.com/*"],
    script: "content-scripts/gmail.js",
  },
]

export const OPTIONAL_ORIGINS = OPTIONAL_SITES.flatMap(s => s.origins)
