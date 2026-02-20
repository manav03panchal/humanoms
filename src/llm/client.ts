import { routeModel } from "./router.ts";
import type { ModelTier } from "./router.ts";
import { createChildLogger } from "../lib/logger.ts";

const log = createChildLogger("llm");

const ANTHROPIC_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
} as const;

export type { ModelTier };

export interface LlmCallInput {
  system?: string;
  prompt: string;
  model?: "auto" | ModelTier;
}

export async function llmCall(input: LlmCallInput): Promise<string> {
  const tier =
    input.model === "auto" || !input.model
      ? routeModel(input.prompt)
      : input.model;

  log.info({ model: tier, promptLength: input.prompt.length }, "LLM call");

  // Use the same CHAT_API_KEY / provider as the chat endpoint
  const provider = process.env.CHAT_PROVIDER || "anthropic";
  const apiKey = process.env.CHAT_API_KEY || process.env.ANTHROPIC_API_KEY || "";

  if (provider === "anthropic") {
    return callAnthropic(apiKey, ANTHROPIC_MODELS[tier], input);
  } else {
    return callOpenAI(
      apiKey,
      process.env.CHAT_BASE_URL || "https://api.openai.com/v1",
      process.env.CHAT_MODEL || "gpt-4o",
      input
    );
  }
}

async function callAnthropic(
  apiKey: string,
  model: string,
  input: LlmCallInput
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: input.system || undefined,
      messages: [{ role: "user", content: input.prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("");
}

async function callOpenAI(
  apiKey: string,
  baseUrl: string,
  model: string,
  input: LlmCallInput
): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  messages.push({ role: "user", content: input.prompt });

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, max_tokens: 4096, messages }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content || "";
}
