import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "bun:sqlite";
import { registerTaskTools } from "./tools/tasks.ts";
import { registerEntityTools } from "./tools/entities.ts";
import { registerWorkflowTools } from "./tools/workflows.ts";
import { registerSystemTools } from "./tools/system.ts";

export function createMcpServer(db: Database): McpServer {
  const server = new McpServer({
    name: "humanoms",
    version: "0.1.0",
  });

  registerTaskTools(server, db);
  registerEntityTools(server, db);
  registerWorkflowTools(server, db);
  registerSystemTools(server, db);

  return server;
}
