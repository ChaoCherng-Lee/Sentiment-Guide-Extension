// Deno entry point of the cloud check (see handler.ts). Deploy:
//
//   supabase secrets set TONE_TOKEN_SECRET=<long random string> TONE_API_KEY=<model provider key>
//   (optional) supabase secrets set TONE_PROVIDER=anthropic TONE_MODEL=claude-haiku-5-5
//   supabase functions deploy tone-check --no-verify-jwt
//
// (The function checks its own install tokens. Supabase's gateway JWT check
// is off because newer sb_publishable_ keys aren't JWTs.)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set by Supabase. The rate
// limit lives in the cloud_rate table (migration 20261121000000).

import { handle } from "./handler.ts"
import { providerFrom } from "./providers.ts"

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const env = (name: string) => Deno.env.get(name) ?? ""

const callModel = providerFrom({
  provider: env("TONE_PROVIDER"),
  apiKey:   env("TONE_API_KEY"),
  model:    env("TONE_MODEL"),
  baseUrl:  env("TONE_BASE_URL"),
})

async function rateHit(key: string, max: number): Promise<boolean> {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/cloud_rate_hit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ p_key: key, p_max: max }),
  })
  // If the counter can't be reached, fail closed: no limit means no cost cap
  if (!res.ok) return false
  return (await res.json()) === true
}

const secret = env("TONE_TOKEN_SECRET")
if (secret.length < 32) throw new Error("TONE_TOKEN_SECRET must be at least 32 characters")

Deno.serve(req => handle(req, {
  secret,
  callModel,
  rateHit,
  // Timing and status only — never the message, context or answer
  log: line => console.log(JSON.stringify(line)),
}))
