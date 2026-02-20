import { initDb, closeDb } from "./db/connection.ts";
import { loadConfig } from "./config.ts";
import { createApp } from "./api/server.ts";
import { createChildLogger } from "./lib/logger.ts";
import { createMcpServer } from "./mcp/server.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JobQueue } from "./jobs/queue.ts";
import { WorkflowExecutor } from "./jobs/executor.ts";
import { Scheduler, RecurringTaskScheduler } from "./scheduler/scheduler.ts";
import { NotificationDispatcher } from "./notifications/dispatcher.ts";
import { createDiscordSender } from "./notifications/discord.ts";
import { SecretStore } from "./security/secrets.ts";
import { deriveKey } from "./security/encryption.ts";
import { ApprovalManager } from "./jobs/approval.ts";
import { createProvider } from "./chat/providers/index.ts";
import { runAgentLoop } from "./chat/agent-loop.ts";
import type { AgentLoopRunner } from "./chat/agent-loop.ts";
import { runClaudeCodeLoop } from "./chat/claude-code-loop.ts";

const log = createChildLogger("main");

const config = loadConfig();
const db = initDb(config.dbPath);

// ── MCP mode (stdio transport) ─────────────────────────────────────
// When invoked with --mcp, run only the MCP server over stdin/stdout
// and skip the HTTP server + background subsystems.
if (process.argv.includes("--mcp")) {
  const mcpServer = createMcpServer(db);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  log.info("MCP server started on stdio");
} else {
  // ── Derive master key + secrets store ────────────────────────────────
  const masterKeyBuffer = deriveKey(config.masterKey, "humanoms-master-salt");
  const secrets = new SecretStore(db, masterKeyBuffer);

  // Read API key hash from database (NOT from .env — Bun's dotenv
  // mangles Argon2 hashes because it expands $ even inside quotes).
  const apiKeyHash = secrets.get("api_key_hash") ?? null;

  // ── Job queue + executor ───────────────────────────────────────────
  const jobQueue = new JobQueue(db);
  const executor = new WorkflowExecutor(db, jobQueue, config.masterKey);

  // ── Scheduler (automations + recurring tasks) ──────────────────────
  const scheduler = new Scheduler(db, (workflowId, input) => {
    jobQueue.enqueue(workflowId, input);
  });
  scheduler.start();

  // ── Chat loop runner ─────────────────────────────────────────────
  let chatLoop: AgentLoopRunner;

  if (config.chatProvider === "claude-code") {
    log.info("Using Claude Code Agent SDK (OAuth credentials, no API key needed)");
    const chatModel = config.chatModel;
    chatLoop = (p) =>
      runClaudeCodeLoop({ ...p, model: chatModel });
  } else {
    if (!config.chatApiKey) {
      log.warn("No CHAT_API_KEY / ANTHROPIC_API_KEY set — chat will not work");
    }
    const provider = createProvider({
      provider: config.chatProvider as "anthropic" | "openai",
      apiKey: config.chatApiKey || "",
      baseUrl: config.chatBaseUrl,
      model:
        config.chatModel ||
        (config.chatProvider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o"),
      maxTokens: config.chatMaxTokens,
    });
    chatLoop = (p) =>
      runAgentLoop({ ...p, provider, maxTurns: 25 });
  }

  // ── HTTP server ────────────────────────────────────────────────────
  const app = createApp({
    db,
    apiKeyHash,
    chatLoop,
    scheduler,
  });

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
    idleTimeout: 255, // seconds — SSE streams (chat) need long-lived connections
  });

  log.info(
    { port: server.port, host: server.hostname },
    "HumanOMS server started"
  );

  let jobPollDelay = 200;
  let jobPollTimer: ReturnType<typeof setTimeout>;
  async function pollJobs() {
    const job = jobQueue.dequeue();
    if (job) {
      jobPollDelay = 200; // fast drain
      try {
        await executor.executeJob(job);
      } catch (err) {
        log.error({ jobId: job.id, err }, "Job execution error");
        jobQueue.updateStatus(job.id, "failed", {
          error: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
        });
      }
    } else {
      jobPollDelay = Math.min(jobPollDelay * 2, 10000); // backoff up to 10s
    }
    jobPollTimer = setTimeout(pollJobs, jobPollDelay);
  }
  jobPollTimer = setTimeout(pollJobs, jobPollDelay);

  const recurringScheduler = new RecurringTaskScheduler(db);
  recurringScheduler.start();

  // ── Notification dispatcher + Discord (optional) ───────────────────
  const dispatcher = new NotificationDispatcher(db);
  executor.setDispatcher(dispatcher);
  const discordToken = secrets.get("discord_bot_token");

  let discordStopBot: (() => void) | null = null;

  if (discordToken) {
    const discordChannelId = secrets.get("discord_channel_id");
    if (!discordChannelId) {
      log.warn("discord_bot_token set but discord_channel_id missing — skipping Discord");
    } else {
      // Ensure a notification_channels row exists for Discord
      db.run(
        `INSERT OR REPLACE INTO notification_channels (id, type, name, config, enabled)
         VALUES ('discord-default', 'discord', 'Discord', ?, 1)`,
        [JSON.stringify({ channel_id: discordChannelId })]
      );

      const approvalManager = new ApprovalManager(db, config.masterKey);
      const { sender, startBot, stopBot } = createDiscordSender(
        approvalManager.resolveApproval.bind(approvalManager)
      );
      dispatcher.registerSender("discord", sender);
      discordStopBot = stopBot;
      startBot(discordToken).catch((err) => {
        log.warn(
          { err },
          "Failed to start Discord bot — notifications will be logged only"
        );
      });
    }
  }

  // ── Graceful shutdown ──────────────────────────────────────────────
  async function shutdown() {
    log.info("Shutting down...");
    clearTimeout(jobPollTimer);
    await executor.shutdown();
    scheduler.stop();
    recurringScheduler.stop();
    if (discordStopBot) discordStopBot();
    server.stop();
    closeDb();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
