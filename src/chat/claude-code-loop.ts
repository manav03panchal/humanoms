import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AgentEvent } from "./agent-loop.ts";
import type { ToolDefinition } from "./tool-def.ts";
import type { ChatMessage } from "./providers/types.ts";
import { createChildLogger } from "../lib/logger.ts";

const log = createChildLogger("claude-code-loop");

// ── Claude Code Agent SDK loop runner ────────────────────────────────────
//
// Wraps the Agent SDK's `query()` as an AsyncGenerator<AgentEvent>,
// making it a drop-in replacement for `runAgentLoop()`.
//
// The SDK spawns the Claude Code CLI as a subprocess.  When the CLI is
// authenticated via `claude login` (OAuth), it uses those credentials —
// no API key needed.  This is ideal for Claude Max subscribers.

export async function* runClaudeCodeLoop(params: {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  system: string;
  model?: string;
  thinking?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { messages, tools, system, signal, model } = params;

  // ── Tool event queue ─────────────────────────────────────────────────
  // MCP tool handlers push events here; the main generator drains them
  // between SDK messages so that the SSE stream sees tool_call / tool_result
  // events interleaved with text.
  const toolEvents: AgentEvent[] = [];

  // ── Convert humanoms tools → SDK MCP tools ───────────────────────────
  const sdkTools = tools.map((t) =>
    tool(t.name, t.description, t.schema.shape, async (args: any) => {
      toolEvents.push({ type: "tool_call", name: t.name, args });

      try {
        const result = await t.handler(args);
        const resultText = result.content[0]?.text || "{}";
        let parsed: unknown;
        try {
          parsed = JSON.parse(resultText);
        } catch {
          parsed = resultText;
        }
        toolEvents.push({ type: "tool_result", name: t.name, result: parsed });
        return result as CallToolResult;
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Tool execution failed";
        toolEvents.push({
          type: "tool_result",
          name: t.name,
          result: { error: errMsg },
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: errMsg }) }],
          isError: true,
        } as CallToolResult;
      }
    })
  );

  // ── In-process MCP server ────────────────────────────────────────────
  const mcpServer = createSdkMcpServer({
    name: "humanoms",
    tools: sdkTools,
  });

  // ── Build prompt from conversation history ───────────────────────────
  // The SDK takes a single `prompt` string.  We put earlier messages into
  // the system prompt as context, and use the latest user message as the
  // prompt.
  const lastUserMsg = messages.filter((m) => m.role === "user").pop();
  const prompt = lastUserMsg?.content || "";

  const priorMessages = messages.slice(0, -1);
  let systemPrompt = system;
  if (priorMessages.length > 0) {
    const history = priorMessages
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${(m.content || "").slice(0, 2000)}`
      )
      .join("\n\n");
    systemPrompt += `\n\n<conversation_history>\n${history}\n</conversation_history>`;
  }

  // ── Abort wiring ─────────────────────────────────────────────────────
  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) return;
    signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  // ── Run the SDK query ────────────────────────────────────────────────
  log.info({ model, toolCount: tools.length }, "Starting Claude Code loop");

  const stream = query({
    prompt,
    options: {
      systemPrompt,
      tools: [],                      // disable all built-in tools
      mcpServers: { humanoms: mcpServer },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      model: model || "claude-sonnet-4-6",
      includePartialMessages: true,
      abortController,
      maxTurns: 25,
      persistSession: false,          // no session persistence needed
      // Strip CLAUDECODE env var so the SDK doesn't think it's nested
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== "CLAUDECODE")
      ),
      stderr: (data: string) => log.warn({ stderr: data.trim() }, "SDK stderr"),
    },
  });

  try {
    for await (const message of stream) {
      if (signal?.aborted) break;

      // Flush any queued tool events first
      while (toolEvents.length > 0) {
        yield toolEvents.shift()!;
      }

      // ── Streaming token events ─────────────────────────────────────
      if (message.type === "stream_event") {
        const event = message.event as any;
        if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta" && event.delta.text) {
            yield { type: "text", text: event.delta.text };
          } else if (
            event.delta?.type === "thinking_delta" &&
            event.delta.thinking
          ) {
            yield { type: "thinking", text: event.delta.thinking };
          }
        }
      }

      // ── Result message (final) ─────────────────────────────────────
      if (message.type === "result") {
        if (message.subtype !== "success") {
          const errMsg =
            "errors" in message
              ? (message as any).errors?.join("; ")
              : "Agent SDK error";
          log.error({ subtype: message.subtype, errMsg }, "SDK query failed");
        }
      }
    }
  } catch (err: any) {
    if (err?.name !== "AbortError" && !signal?.aborted) {
      log.error({ err }, "Claude Code loop error");
      throw err;
    }
  } finally {
    // Flush remaining tool events
    while (toolEvents.length > 0) {
      yield toolEvents.shift()!;
    }
  }
}
