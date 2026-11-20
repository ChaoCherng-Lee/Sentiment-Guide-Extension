// Backends the eval can score from Node. Chrome's built-in AI only runs in
// Chrome, so it can't be scored here (see CHANGES.md, 8.2).
//
// cloud: the deployed tone-check function of the Supabase project in .env
// (WXT_SUPABASE_URL / WXT_SUPABASE_ANON_KEY), or SG_CLOUD_URL /
// SG_CLOUD_ANON_KEY to score another deployment (e.g. one per model).

import { existsSync } from "node:fs"
import type { ToneBackend } from "../src/analysis/backend"
import { cloudBackend } from "../src/analysis/cloud"
import { ollamaBackend } from "../src/analysis/ollama"

export function evalBackend(id: string, model: string | null): ToneBackend {
  switch (id) {
    case "ollama":
      return ollamaBackend(() => model)
    case "cloud": {
      if (existsSync(".env")) process.loadEnvFile(".env")
      const base = process.env.SG_CLOUD_URL ?? (process.env.WXT_SUPABASE_URL ? `${process.env.WXT_SUPABASE_URL}/functions/v1/tone-check` : "")
      const anonKey = process.env.SG_CLOUD_ANON_KEY ?? process.env.WXT_SUPABASE_ANON_KEY ?? ""
      if (!base || !anonKey) throw new Error("No cloud check configured: set WXT_SUPABASE_URL and WXT_SUPABASE_ANON_KEY in .env")
      let token: string | null = null
      return cloudBackend({ url: base, anonKey, tokens: { get: async () => token, set: async t => { token = t } } })
    }
    default:
      throw new Error(`Unknown backend "${id}" — try: ollama, cloud`)
  }
}
