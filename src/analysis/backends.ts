// Which backend serves a check (Plan 8.1). Kept apart from backend.ts so the
// interface doesn't pull in every implementation. Used by the background
// worker only.

import type { BackendId, ToneBackend } from "./backend"
import { builtinBackend } from "./builtin"
import { ollamaBackend } from "./ollama"
import { backgroundHost } from "./offscreen-host"
import { getSettings } from "../settings/store"

const ollama  = ollamaBackend(async () => (await getSettings()).model)
// One host for the worker's lifetime, so its sessions are reused between checks
let host: ReturnType<typeof backgroundHost> | null = null
const builtin = builtinBackend(async () => (host ??= backgroundHost()))

export function backendFor(id: BackendId): ToneBackend {
  switch (id) {
    case "builtin": return builtin
    case "ollama":
    default:        return ollama
  }
}
