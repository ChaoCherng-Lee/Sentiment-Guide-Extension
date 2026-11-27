// Copies the prompt code the cloud check needs (Plan 8.3) from src/analysis
// into supabase/functions/_shared/analysis, so the server asks the model
// exactly what the extension would. Supabase deploys each function from the
// supabase/ folder only, and Deno wants ".ts" on relative imports.
//
//   npm run sync:function
//
// test/unit/cloud-function.test.ts fails when the copy is out of date.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const SRC  = path.join(ROOT, "src/analysis")
export const DEST = path.join(ROOT, "supabase/functions/_shared/analysis")
export const FILES = [
  "prompts.ts", "schema.ts", "emoji.ts", "emoji-lexicon.json", "tone-tags.ts", "context-questions.ts", "types.ts",
]

const HEADER = "// GENERATED from src/analysis by scripts/sync-function.mjs — edit the original, then run npm run sync:function\n\n"

/** The Deno version of one file. */
export function transform(file, source) {
  if (file.endsWith(".json")) return source
  const out = source
    .replace(/(from\s+"\.\/[\w.-]+\.json)"/g, '$1" with { type: "json" }')
    .replace(/(from\s+"\.\/[\w-]+)"/g, '$1.ts"')
  return HEADER + out
}

export function expected() {
  return FILES.map(file => ({ file, text: transform(file, readFileSync(path.join(SRC, file), "utf8").replace(/\r\n/g, "\n")) }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(DEST, { recursive: true })
  for (const { file, text } of expected()) writeFileSync(path.join(DEST, file), text)
  console.log(`Copied ${FILES.length} files to ${path.relative(ROOT, DEST)}`)
}
