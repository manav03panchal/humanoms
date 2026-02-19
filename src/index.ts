import { initDb, closeDb } from "./db/connection.ts";
import { loadConfig } from "./config.ts";
import { createApp } from "./api/server.ts";
import { createChildLogger } from "./lib/logger.ts";

const log = createChildLogger("main");

const config = loadConfig();
const db = initDb(config.dbPath);

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

process.on("SIGINT", () => {
  log.info("Shutting down...");
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Shutting down...");
  closeDb();
  process.exit(0);
});
