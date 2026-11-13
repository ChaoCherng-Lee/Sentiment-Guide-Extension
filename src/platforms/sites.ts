// Sites the user switches on one by one (Plan Phase 4), and "all websites".
// Each needs an optional host permission, granted from the settings or setup
// page; the background worker registers the site's content script only while
// it is granted. WhatsApp is always on and is not listed here.
//
// Allowing all websites covers Instagram and Gmail too, so they come on with
// it (with their own scripts, which know those sites).

export interface OptionalSite {
  id: "web" | "instagram" | "gmail"
  name: string
  description: string
  /** Host permission patterns; also the content script's matches */
  origins: string[]
  /** Pages the script must not run on, though `origins` covers them */
  excludeMatches?: string[]
  /** Built content script, as WXT names it */
  script: string
}

export const WHATSAPP_ORIGIN = "https://web.whatsapp.com/*"

const INSTAGRAM: OptionalSite = {
  id: "instagram",
  name: "Instagram DMs",
  description: "Checks messages you write in Instagram direct messages (instagram.com/direct).",
  // The whole site, not just /direct: Instagram changes page without reloading
  origins: ["https://www.instagram.com/*"],
  script: "content-scripts/instagram.js",
}

const GMAIL: OptionalSite = {
  id: "gmail",
  name: "Gmail",
  description: "Checks emails you write in Gmail: the paragraph you're writing as you go, and the whole email when you press Send.",
  origins: ["https://mail.google.com/*"],
  script: "content-scripts/gmail.js",
}

export const ALL_WEBSITES: OptionalSite = {
  id: "web",
  name: "All websites",
  description: "Checks what you write in text boxes on any website: comments, posts, forms, other chat apps. Includes Instagram and Gmail.",
  origins: ["https://*/*", "http://*/*"],
  // These have scripts of their own
  excludeMatches: [WHATSAPP_ORIGIN, ...INSTAGRAM.origins, ...GMAIL.origins],
  script: "content-scripts/web.js",
}

export const OPTIONAL_SITES: OptionalSite[] = [ALL_WEBSITES, INSTAGRAM, GMAIL]

export const OPTIONAL_ORIGINS = OPTIONAL_SITES.flatMap(s => s.origins)
