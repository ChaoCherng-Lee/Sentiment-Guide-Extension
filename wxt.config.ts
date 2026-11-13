import { defineConfig } from "wxt"
import { OPTIONAL_ORIGINS } from "./src/platforms/sites"

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Explicit imports only — keeps modules readable and testable outside WXT
  imports: false,
  manifest: ({ mode }) => ({
    name: "Sentiment Guide",
    description: "Tone analysis for kinder texting — like Grammarly for sentiment",
    // declarativeNetRequest strips the Origin header from our own requests to
    // Ollama, which otherwise rejects chrome-extension:// origins.
    // scripting registers the content scripts of optional sites once allowed.
    permissions: ["storage", "alarms", "declarativeNetRequestWithHostAccess", "scripting"],
    host_permissions: [
      "http://127.0.0.1:11434/*",
      "http://localhost:11434/*",
      "https://*.supabase.co/*",
      // End-to-end tests can't click Chrome's permission prompt, so their
      // build starts with every optional site already allowed
      ...(mode === "e2e" ? OPTIONAL_ORIGINS : []),
    ],
    // Instagram and Gmail are switched on one by one in the options page
    optional_host_permissions: mode === "e2e" ? [] : OPTIONAL_ORIGINS,
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    commands: {
      "toggle-enabled": {
        suggested_key: { default: "Alt+Shift+G" },
        description: "Turn Sentiment Guide on or off",
      },
    },
    action: {
      default_icon: { 16: "icon/16.png", 32: "icon/32.png" },
    },
  }),
  hooks: {
    // WXT makes the matches of runtime-registered content scripts required
    // host permissions. They must stay optional, so take them back out.
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.mode === "e2e") return
      manifest.host_permissions = (manifest.host_permissions ?? []).filter((p: string) => !OPTIONAL_ORIGINS.includes(p))
    },
  },
})
