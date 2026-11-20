// Which backend serves a check (Plan 8.1). Kept apart from backend.ts so the
// interface doesn't pull in every implementation.

import type { BackendId, ToneBackend } from "./backend"
import { ollamaBackend } from "./ollama"
import { getSettings } from "../settings/store"

const ollama = ollamaBackend(async () => (await getSettings()).model)

export function backendFor(id: BackendId): ToneBackend {
  switch (id) {
    case "ollama":
    default:
      return ollama
  }
}
