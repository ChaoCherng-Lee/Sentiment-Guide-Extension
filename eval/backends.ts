// Backends the eval can score from Node. Chrome's built-in AI only runs in
// Chrome, so it's scored from inside the extension instead (Plan 8.2).

import type { ToneBackend } from "../src/analysis/backend"
import { ollamaBackend } from "../src/analysis/ollama"

export function evalBackend(id: string, model: string | null): ToneBackend {
  switch (id) {
    case "ollama":
      return ollamaBackend(() => model)
    default:
      throw new Error(`Unknown backend "${id}" — try: ollama`)
  }
}
