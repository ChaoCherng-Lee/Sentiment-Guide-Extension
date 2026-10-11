import { defineConfig } from "wxt"

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Explicit imports only — keeps modules readable and testable outside WXT
  imports: false,
  manifest: {
    name: "Sentiment Guide",
    description: "Tone analysis for kinder texting — like Grammarly for sentiment",
    permissions: ["storage"],
    host_permissions: [
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
