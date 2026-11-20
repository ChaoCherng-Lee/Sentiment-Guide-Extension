// Which backend serves a check (Plan 8.1). Kept apart from backend.ts so the
// interface doesn't pull in every implementation. Used by the background
// worker only.

import type { BackendId, ToneBackend } from "./backend"
import { builtinBackend } from "./builtin"
import { cloudBackend } from "./cloud"
import { ollamaBackend } from "./ollama"
import { backgroundHost } from "./offscreen-host"
import { browser } from "#imports"
import { getSettings } from "../settings/store"

const ollama  = ollamaBackend(async () => (await getSettings()).model)
// One host for the worker's lifetime, so its sessions are reused between checks
let host: ReturnType<typeof backgroundHost> | null = null
const builtin = builtinBackend(async () => (host ??= backgroundHost()))

// The cloud check lives in the same Supabase project as parent sharing
const SUPABASE_URL      = (import.meta.env.WXT_SUPABASE_URL as string | undefined) ?? ""
const SUPABASE_ANON_KEY = (import.meta.env.WXT_SUPABASE_ANON_KEY as string | undefined) ?? ""
const TOKEN_KEY = "cloudToken"
const cloud = cloudBackend(SUPABASE_URL && SUPABASE_ANON_KEY ? {
  url:     `${SUPABASE_URL}/functions/v1/tone-check`,
  anonKey: SUPABASE_ANON_KEY,
  tokens: {
    get: async () => ((await browser.storage.local.get(TOKEN_KEY))[TOKEN_KEY] as string | undefined) ?? null,
    set: async (token) => { token ? await browser.storage.local.set({ [TOKEN_KEY]: token }) : await browser.storage.local.remove(TOKEN_KEY) },
  },
} : null)

export function backendFor(id: BackendId): ToneBackend {
  switch (id) {
    case "builtin": return builtin
    case "cloud":   return cloud
    case "ollama":
    default:        return ollama
  }
}
