import type { ChatProvider, ChatMessage } from "./providers/types.ts";
import type { ToolDefinition } from "./tool-def.ts";
import { createChildLogger } from "../lib/logger.ts";

const log = createChildLogger("agent-loop");

// ── Events yielded to the caller (chat route) ───────────────────────────

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown };

// ── Agent loop ───────────────────────────────────────────────────────────

export async function* runAgentLoop(params: {
  provider: ChatProvider;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  system: string;
  maxTurns?: number;
  thinking?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { provider, tools, system, signal } = params;
  const maxTurns = params.maxTurns ?? 25;
  const messages: ChatMessage[] = [...params.messages];
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) return;

    const toolCalls: { id: string; name: string; args: unknown }[] = [];
    let text = "";

    // Stream one LLM turn
    for await (const event of provider.chat({
      messages,
      tools,
      system,
      thinking: params.thinking,
      signal,
    })) {
      if (signal?.aborted) return;

      switch (event.type) {
        case "text":
          text += event.text;
          yield { type: "text", text: event.text };
          break;

        case "thinking":
          yield { type: "thinking", text: event.text };
          break;

        case "tool_call":
          toolCalls.push({ id: event.id, name: event.name, args: event.args });
          yield { type: "tool_call", name: event.name, args: event.args };
          break;

        case "done":
          break;
      }
    }

    // No tool calls → model is done
    if (toolCalls.length === 0) return;

    // Add assistant message with tool calls
    messages.push({ role: "assistant", content: text, toolCalls });

    // Execute each tool call and feed results back
    for (const tc of toolCalls) {
      if (signal?.aborted) return;

      const tool = toolMap.get(tc.name);
      let resultContent: string;

      if (!tool) {
        resultContent = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
      } else {
        const parsed = tool.schema.safeParse(tc.args);
        if (!parsed.success) {
          resultContent = JSON.stringify({
            error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          });
        } else {
          try {
            const result = await tool.handler(parsed.data);
            resultContent = result.content[0]?.text || "{}";
          } catch (err) {
            log.error({ tool: tc.name, err }, "Tool execution error");
            resultContent = JSON.stringify({
              error: err instanceof Error ? err.message : "Tool execution failed",
            });
          }
        }
      }

      // Emit tool result event (parse for frontend card rendering)
      try {
        yield { type: "tool_result", name: tc.name, result: JSON.parse(resultContent) };
      } catch {
        yield { type: "tool_result", name: tc.name, result: resultContent };
      }

      messages.push({ role: "tool", toolCallId: tc.id, content: resultContent });
    }
  }
}
