import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database } from "bun:sqlite";
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { buildChatTools } from "../../chat/tools.ts";
import { buildSystemPrompt } from "../../chat/system-prompt.ts";
import { generateId } from "../../lib/ulid.ts";
import { createChildLogger } from "../../lib/logger.ts";

const log = createChildLogger("chat");

import type { Scheduler } from "../../scheduler/scheduler.ts";

export function createChatRoutes(db: Database, scheduler?: Scheduler) {
  const app = new Hono();
  const baseTools = buildChatTools(db, undefined, scheduler);

  app.post("/chat", async (c) => {
    const body = await c.req.json<{
      message: string;
      conversation_id?: string;
    }>();

    if (!body.message || typeof body.message !== "string") {
      return c.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "message is required" } },
        400
      );
    }

    const conversationId = body.conversation_id || generateId();
    const now = new Date().toISOString();

    // Save user message
    const userMsgId = generateId();
    db.run(
      `INSERT INTO chat_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
      [userMsgId, conversationId, body.message, now]
    );

    // Load conversation history (last 20 messages, truncated)
    const history = db
      .query(
        `SELECT role, content, tool_calls FROM chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC
         LIMIT 20`
      )
      .all(conversationId) as { role: string; content: string; tool_calls: string | null }[];

    // Build prompt from conversation history
    const conversationText = history
      .map((msg) => {
        const prefix = msg.role === "user" ? "User" : "Assistant";
        // For assistant messages with tool_calls, strip them (huge JSON blobs)
        // Truncate each message to 2000 chars max
        const content = msg.content ? msg.content.slice(0, 2000) : "";
        return `${prefix}: ${content}`;
      })
      .join("\n\n");

    const systemPrompt = buildSystemPrompt(db);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "conversation_id", data: conversationId });

      let fullText = "";
      let lastTextBlock = "";
      const toolCalls: { tool: string; input: unknown; result: unknown }[] = [];

      // Wrap each tool handler to intercept results and emit SSE events
      const wrappedTools: any[] = baseTools.map((t: any) => {
        const originalHandler = t.handler;
        return {
          ...t,
          handler: async (args: any, extra: any) => {
            const result = await originalHandler(args, extra);
            // Extract the text content from the MCP result
            const content = result?.content;
            if (content?.[0]?.text) {
              try {
                const parsed = JSON.parse(content[0].text);
                await stream.writeSSE({
                  event: "tool_result",
                  data: JSON.stringify({ tool: t.name, result: parsed }),
                });
                // Update the matching tool call
                const idx = toolCalls.findIndex(
                  (tc) => tc.tool === t.name && tc.result === null
                );
                if (idx !== -1) toolCalls[idx]!.result = parsed;
              } catch {
                await stream.writeSSE({
                  event: "tool_result",
                  data: JSON.stringify({ tool: t.name, result: content[0].text }),
                });
              }
            }
            return result;
          },
        };
      });

      const mcpServer = createSdkMcpServer({
        name: "humanoms-tools",
        version: "1.0.0",
        tools: wrappedTools,
      });

      try {
        const wantsThinking = /\bthink\b/i.test(body.message);
        const conversation = query({
          prompt: conversationText,
          options: {
            systemPrompt,
            mcpServers: { "humanoms-tools": mcpServer },
            allowedTools: [
              ...baseTools.map((t: any) => `mcp__humanoms-tools__${t.name}`),
              "WebSearch",
              "WebFetch",
              "Glob",
              "Grep",
              "Read",
            ],
            maxTurns: 25,
            model: "claude-sonnet-4-6",
            thinking: wantsThinking
              ? { type: "enabled", budgetTokens: 10000 }
              : { type: "disabled" },
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            tools: [],
          },
        });

        for await (const msg of conversation) {
          if (stream.aborted) break;
          if (msg.type === "assistant") {
            for (const block of (msg as any).message.content) {
              if (stream.aborted) break;
              if (block.type === "thinking" && block.thinking) {
                await stream.writeSSE({ event: "thinking", data: block.thinking });
              }
              if (block.type === "tool_use") {
                // Strip the MCP prefix for cleaner display
                const cleanName = block.name.replace(/^mcp__humanoms-tools__/, "");
                await stream.writeSSE({
                  event: "tool_call",
                  data: JSON.stringify({ tool: cleanName, input: block.input }),
                });
                toolCalls.push({ tool: cleanName, input: block.input, result: null });
              }
              if (block.type === "text" && block.text && block.text !== lastTextBlock) {
                lastTextBlock = block.text;
                fullText += block.text;
                await stream.writeSSE({ event: "text", data: block.text });
              }
            }
          } else if (msg.type === "result") {
            const resultMsg = msg as any;
            if (resultMsg.subtype === "success" && resultMsg.result && !fullText) {
              fullText = resultMsg.result;
              await stream.writeSSE({ event: "text", data: resultMsg.result });
            }
          }
        }
      } catch (err) {
        log.error({ err }, "Chat query error");
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: "An error occurred during chat processing" }),
        });
      }

      // Save assistant response
      if (fullText) {
        const assistantMsgId = generateId();
        db.run(
          `INSERT INTO chat_messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`,
          [
            assistantMsgId,
            conversationId,
            fullText,
            toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
            new Date().toISOString(),
          ]
        );
      }

      await stream.writeSSE({ event: "done", data: "{}" });
    });
  });

  return app;
}
