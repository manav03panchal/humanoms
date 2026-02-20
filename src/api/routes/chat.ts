import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database } from "bun:sqlite";
import { buildChatTools } from "../../chat/tools.ts";
import { buildSystemPrompt } from "../../chat/system-prompt.ts";
import type { AgentLoopRunner } from "../../chat/agent-loop.ts";
import type { ChatMessage } from "../../chat/providers/types.ts";
import { generateId } from "../../lib/ulid.ts";
import { createChildLogger } from "../../lib/logger.ts";

const log = createChildLogger("chat");

import type { Scheduler } from "../../scheduler/scheduler.ts";

export function createChatRoutes(
  db: Database,
  chatLoop: AgentLoopRunner,
  scheduler?: Scheduler
) {
  const app = new Hono();
  const tools = buildChatTools(db, undefined, scheduler);

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

    // Load conversation history
    const history = db
      .query(
        `SELECT role, content FROM chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC
         LIMIT 20`
      )
      .all(conversationId) as { role: string; content: string }[];

    // Build message array for provider
    const messages: ChatMessage[] = history.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: (msg.content || "").slice(0, 2000),
    }));

    const systemPrompt = buildSystemPrompt(db);
    const wantsThinking = /\bthink\b/i.test(body.message);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "conversation_id", data: conversationId });

      let fullText = "";
      const toolCalls: { tool: string; input: unknown; result: unknown }[] = [];

      try {
        for await (const event of chatLoop({
          messages,
          tools,
          system: systemPrompt,
          thinking: wantsThinking,
          signal: c.req.raw.signal,
        })) {
          if (stream.aborted) break;

          switch (event.type) {
            case "text":
              fullText += event.text;
              await stream.writeSSE({ event: "text", data: event.text });
              break;

            case "thinking":
              await stream.writeSSE({ event: "thinking", data: event.text });
              break;

            case "tool_call":
              await stream.writeSSE({
                event: "tool_call",
                data: JSON.stringify({ tool: event.name, input: event.args }),
              });
              toolCalls.push({ tool: event.name, input: event.args, result: null });
              break;

            case "tool_result": {
              await stream.writeSSE({
                event: "tool_result",
                data: JSON.stringify({ tool: event.name, result: event.result }),
              });
              const idx = toolCalls.findIndex(
                (tc) => tc.tool === event.name && tc.result === null
              );
              if (idx !== -1) toolCalls[idx]!.result = event.result;
              break;
            }
          }
        }
      } catch (err) {
        if ((err as any)?.name !== "AbortError") {
          log.error({ err }, "Chat query error");
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ message: "An error occurred during chat processing" }),
          });
        }
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
