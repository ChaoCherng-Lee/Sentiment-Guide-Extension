import { defineConfig } from "wxt"

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Explicit imports only — keeps modules readable and testable outside WXT
  imports: false,
  manifest: {
    name: "Sentiment Guide",
    description: "Tone analysis for kinder texting — like Grammarly for sentiment",
    // declarativeNetRequest strips the Origin header from our own requests to
    // Ollama, which otherwise rejects chrome-extension:// origins
    permissions: ["storage", "declarativeNetRequestWithHostAccess"],
    host_permissions: [
      "http://127.0.0.1:11434/*",
      "http://localhost:11434/*",
      "https://*.supabase.co/*",
    ],
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    action: {
      default_icon: { 16: "icon/16.png", 32: "icon/32.png" },
    },
  },
})
