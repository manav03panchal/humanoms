import type { ChatProvider, ProviderConfig } from "./types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAIProvider } from "./openai.ts";

export function createProvider(config: ProviderConfig): ChatProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
      });

    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        maxTokens: config.maxTokens,
      });

    default:
      throw new Error(`Unknown chat provider: ${config.provider}`);
  }
}

export type { ChatProvider, ChatEvent, ChatMessage, ProviderConfig } from "./types.ts";
