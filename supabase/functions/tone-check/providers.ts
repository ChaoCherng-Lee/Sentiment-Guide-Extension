// Hosted models the cloud check can use. Picked with env TONE_PROVIDER; the
// model with TONE_MODEL. Which one ships is decided by the eval (Spec open
// question 1): run `npm run eval -- --backend cloud` against each.
//
// Turn on the provider's zero-data-retention setting where it offers one
// (Spec FR-4.3); nothing here stores requests either way.

import type { ChatTurn } from "../_shared/analysis/prompts.ts"

export type CallModel = (messages: ChatTurn[], schema: object, signal: AbortSignal) => Promise<unknown>

export interface ProviderConfig {
  provider: string
  apiKey: string
  model?: string
  /** OpenAI-compatible APIs: base URL, e.g. https://api.openai.com/v1 */
  baseUrl?: string
}

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5"

/** System turn on its own; the rest as the conversation. */
function split(messages: ChatTurn[]) {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n")
  const rest = messages.filter(m => m.role !== "system").map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
  return { system, rest }
}

/**
 * Anthropic Messages API. The answer comes back as the input of a tool the
 * model is made to call, whose input schema is ours, so it is always JSON of
 * the right shape.
 */
export function anthropic(apiKey: string, model = DEFAULT_ANTHROPIC_MODEL, fetchImpl: typeof fetch = fetch): CallModel {
  return async (messages, schema, signal) => {
    const { system, rest } = split(messages)
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.2,
        system,
        messages: rest,
        tools: [{ name: "answer", description: "Give your answer.", input_schema: schema }],
        tool_choice: { type: "tool", name: "answer" },
      }),
      signal,
    })
    if (!res.ok) throw new Error(`model HTTP ${res.status}`)
    const data = await res.json() as { content?: { type: string; input?: unknown }[] }
    const call = data.content?.find(c => c.type === "tool_use")
    if (!call) throw new Error("model gave no answer")
    return call.input
  }
}

/** Any OpenAI-compatible chat completions API that supports JSON-schema output. */
export function openaiCompatible(apiKey: string, baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): CallModel {
  return async (messages, schema, signal) => {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        response_format: { type: "json_schema", json_schema: { name: "answer", schema } },
      }),
      signal,
    })
    if (!res.ok) throw new Error(`model HTTP ${res.status}`)
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    return JSON.parse(data.choices?.[0]?.message?.content ?? "")
  }
}

export function providerFrom(cfg: ProviderConfig): CallModel {
  if (!cfg.apiKey) throw new Error("TONE_API_KEY is not set")
  switch (cfg.provider) {
    case "anthropic":
    case "":
      return anthropic(cfg.apiKey, cfg.model || DEFAULT_ANTHROPIC_MODEL)
    case "openai-compatible":
      if (!cfg.baseUrl || !cfg.model) throw new Error("TONE_BASE_URL and TONE_MODEL are needed for openai-compatible")
      return openaiCompatible(cfg.apiKey, cfg.baseUrl, cfg.model)
    default:
      throw new Error(`unknown TONE_PROVIDER "${cfg.provider}"`)
  }
}
