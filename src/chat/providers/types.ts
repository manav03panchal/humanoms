import type { ToolDefinition } from "../tool-def.ts";

// ── Chat events yielded by providers ─────────────────────────────────────

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done" };

// ── Message types for the provider API ───────────────────────────────────

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: { id: string; name: string; args: unknown }[] }
  | { role: "tool"; toolCallId: string; content: string };

// ── Provider interface ───────────────────────────────────────────────────

export interface ChatProvider {
  readonly name: string;

  chat(params: {
    messages: ChatMessage[];
    tools: ToolDefinition[];
    system: string;
    thinking?: boolean;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatEvent>;
}

// ── Provider config ──────────────────────────────────────────────────────

export interface ProviderConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
}
