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
  // ── HTTP server ────────────────────────────────────────────────────
  const app = createApp({
    db,
    apiKeyHash: config.apiKeyHash ?? null,
  });

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
  });

  log.info(
    { port: server.port, host: server.hostname },
    "HumanOMS server started"
  );

  // ── Job queue + executor ───────────────────────────────────────────
  const jobQueue = new JobQueue(db);
  const executor = new WorkflowExecutor(db, jobQueue, config.masterKey);

  const jobPollInterval = setInterval(async () => {
    const job = jobQueue.dequeue();
    if (job) {
      try {
        await executor.executeJob(job);
      } catch (err) {
        log.error({ jobId: job.id, err }, "Job execution error");
        jobQueue.updateStatus(job.id, "failed", {
          error: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
        });
      }
    }
  }, 2000);

  // ── Scheduler (automations + recurring tasks) ──────────────────────
  const scheduler = new Scheduler(db, (workflowId, input) => {
    jobQueue.enqueue(workflowId, input);
  });
  scheduler.start();

  const recurringScheduler = new RecurringTaskScheduler(db);
  recurringScheduler.start();

  // ── Notification dispatcher + Discord (optional) ───────────────────
  const dispatcher = new NotificationDispatcher(db);

  const masterKeyBuffer = deriveKey(config.masterKey, "humanoms-master-salt");
  const secrets = new SecretStore(db, masterKeyBuffer);
  const discordToken = secrets.get("discord_bot_token");

  let discordStopBot: (() => void) | null = null;

  if (discordToken) {
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

  // ── Graceful shutdown ──────────────────────────────────────────────
  async function shutdown() {
    log.info("Shutting down...");
    clearInterval(jobPollInterval);
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
