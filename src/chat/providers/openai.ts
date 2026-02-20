import type { ChatProvider, ChatEvent, ChatMessage } from "./types.ts";
import type { ToolDefinition } from "../tool-def.ts";
import { zodToJsonSchema } from "../tool-def.ts";

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
}

export class OpenAIProvider implements ChatProvider {
  readonly name = "openai";
  private config: OpenAIConfig;

  constructor(config: { apiKey: string; baseUrl?: string; model?: string; maxTokens?: number }) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: config.model || "gpt-4o",
      maxTokens: config.maxTokens || 8192,
    };
  }

  async *chat(params: {
    messages: ChatMessage[];
    tools: ToolDefinition[];
    system: string;
    thinking?: boolean;
    signal?: AbortSignal;
  }): AsyncGenerator<ChatEvent> {
    const tools = params.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.schema),
      },
    }));

    const messages = this.convertMessages(params.messages, params.system);

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages,
      tools,
      stream: true,
    };

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`${this.config.baseUrl} error ${res.status}: ${err}`);
    }

    yield* this.parseStream(res);
  }

  private convertMessages(messages: ChatMessage[], system: string): unknown[] {
    const result: unknown[] = [{ role: "system", content: system }];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const m: Record<string, unknown> = { role: "assistant" };
        if (msg.content) m.content = msg.content;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          m.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
        }
        result.push(m);
      } else if (msg.role === "tool") {
        result.push({
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: msg.content,
        });
      }
    }

    return result;
  }

  private async *parseStream(res: Response): AsyncGenerator<ChatEvent> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track tool calls being accumulated
    const pendingTools: Map<number, { id: string; name: string; argsJson: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const raw = trimmed.slice(6);
        if (raw === "[DONE]") {
          // Flush any pending tool calls
          for (const [, tc] of pendingTools) {
            let args: unknown = {};
            try {
              args = JSON.parse(tc.argsJson || "{}");
            } catch {}
            yield { type: "tool_call", id: tc.id, name: tc.name, args };
          }
          pendingTools.clear();
          yield { type: "done" };
          return;
        }

        let chunk: any;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          yield { type: "text", text: delta.content };
        }

        // Tool calls (streamed incrementally)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (tc.id) {
              // New tool call starting
              pendingTools.set(idx, {
                id: tc.id,
                name: tc.function?.name || "",
                argsJson: tc.function?.arguments || "",
              });
            } else {
              // Continuation of existing tool call
              const existing = pendingTools.get(idx);
              if (existing) {
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.argsJson += tc.function.arguments;
              }
            }
          }
        }

        // Finish reason — flush tool calls
        const finish = chunk.choices?.[0]?.finish_reason;
        if (finish === "tool_calls" || finish === "stop") {
          for (const [, tc] of pendingTools) {
            let args: unknown = {};
            try {
              args = JSON.parse(tc.argsJson || "{}");
            } catch {}
            yield { type: "tool_call", id: tc.id, name: tc.name, args };
          }
          pendingTools.clear();
        }
      }
    }
  }
}
