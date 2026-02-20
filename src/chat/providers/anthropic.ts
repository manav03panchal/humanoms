import type { ChatProvider, ChatEvent, ChatMessage } from "./types.ts";
import type { ToolDefinition } from "../tool-def.ts";
import { zodToJsonSchema } from "../tool-def.ts";

interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic";
  private config: AnthropicConfig;

  constructor(config: { apiKey: string; model?: string; maxTokens?: number }) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || "claude-sonnet-4-6",
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
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.schema),
    }));

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: params.system,
      tools,
      messages: this.convertMessages(params.messages),
      stream: true,
    };

    if (params.thinking) {
      body.thinking = { type: "enabled", budget_tokens: 10000 };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    yield* this.parseStream(res);
  }

  private convertMessages(messages: ChatMessage[]): unknown[] {
    const result: unknown[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        const content: unknown[] = [];
        if (msg.content) content.push({ type: "text", text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
          }
        }
        result.push({ role: "assistant", content });
      } else if (msg.role === "tool") {
        // Anthropic puts tool results in a user message
        const last = result[result.length - 1] as any;
        if (last?.role === "user" && Array.isArray(last.content)) {
          last.content.push({
            type: "tool_result",
            tool_use_id: msg.toolCallId,
            content: msg.content,
          });
        } else {
          result.push({
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content },
            ],
          });
        }
      }
    }

    return result;
  }

  private async *parseStream(res: Response): AsyncGenerator<ChatEvent> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track current content blocks by index
    const blocks: Map<number, { type: string; id?: string; name?: string; argsJson?: string }> =
      new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;

        let event: any;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }

        switch (event.type) {
          case "content_block_start": {
            const block = event.content_block;
            blocks.set(event.index, {
              type: block.type,
              id: block.id,
              name: block.name,
              argsJson: "",
            });
            break;
          }

          case "content_block_delta": {
            const delta = event.delta;
            const block = blocks.get(event.index);

            if (delta.type === "text_delta" && delta.text) {
              yield { type: "text", text: delta.text };
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              yield { type: "thinking", text: delta.thinking };
            } else if (delta.type === "input_json_delta" && block) {
              block.argsJson = (block.argsJson || "") + delta.partial_json;
            }
            break;
          }

          case "content_block_stop": {
            const block = blocks.get(event.index);
            if (block?.type === "tool_use" && block.name) {
              let args: unknown = {};
              try {
                args = JSON.parse(block.argsJson || "{}");
              } catch {}
              yield { type: "tool_call", id: block.id!, name: block.name, args };
            }
            blocks.delete(event.index);
            break;
          }

          case "message_stop":
            yield { type: "done" };
            break;
        }
      }
    }
  }
}
