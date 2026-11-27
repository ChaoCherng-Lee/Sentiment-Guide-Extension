// "What's new" in Settings (Plan 12.4): the newest release first. Add an
// entry when the version in package.json goes up.

export interface Release {
  version: string
  items: string[]
}

export const RELEASES: Release[] = [
  {
    version: "1.2.0",
    items: [
      "Works without installing anything: Chrome's built-in AI or a private cloud check, with Ollama still there for full privacy",
      "Gentle, Balanced or Strict: pick how readily it flags",
      "Learns from \"It's fine\": messages like ones you said were fine stop being flagged",
      "Pauses before a hurtful message is sent; Send anyway is one click, or Ctrl+Enter",
      "Two or three rewrites in your own voice to pick from",
      "Checked on Discord, Messenger, Telegram, X, Reddit, LinkedIn and Slack",
      "Stays out of passwords, card and address fields, and banking, health and government sites",
      "A Privacy tab: what leaves your computer, and Delete everything",
      "Works from the keyboard: Alt+↓ moves into the card, Escape goes back",
    ],
  },
]

/** The release notes for a version, or the newest */
export function releaseFor(version: string): Release {
  return RELEASES.find(r => r.version === version) ?? RELEASES[0]
}
