import { routeModel } from "./router.ts";
import type { ModelTier } from "./router.ts";
import { createChildLogger } from "../lib/logger.ts";

const log = createChildLogger("llm");

const MODEL_MAP = {
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

  // Dynamic import to avoid hard dependency on claude-agent-sdk at module load time
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = await import(
      /* @vite-ignore */ "@anthropic-ai/claude-agent-sdk" as string
    ) as { query: (opts: unknown) => AsyncIterable<Record<string, unknown>> };

    const fullPrompt = input.system
      ? `${input.system}\n\n${input.prompt}`
      : input.prompt;

    let result = "";
    for await (const message of sdk.query({
      prompt: fullPrompt,
      options: {
        model: MODEL_MAP[tier],
        maxTurns: 1,
        allowedTools: [],
      },
    })) {
      if ("result" in message) {
        result = message.result as string;
      }
    }
    return result;
  } catch (err) {
    log.error({ err }, "LLM call failed — SDK may not be available");
    throw new Error("LLM call failed: Claude Agent SDK not available");
  }
}
