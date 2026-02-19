import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Database } from "bun:sqlite";
import { createChildLogger } from "../../lib/logger.ts";

const log = createChildLogger("mcp-client");

interface ToolRegistryRow {
  id: string;
  name: string;
  transport: string;
  config: string;
  capabilities: string;
  health_status: string;
}

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class McpClientPool {
  private db: Database;
  private clients: Map<string, Client> = new Map();

  constructor(db: Database) {
    this.db = db;
  }

  async getClient(serverName: string): Promise<Client> {
    const existing = this.clients.get(serverName);
    if (existing) return existing;

    const row = this.db
      .query<ToolRegistryRow, [string]>(
        "SELECT * FROM tool_registry WHERE name = ?"
      )
      .get(serverName);

    if (!row) {
      throw new Error(`MCP server "${serverName}" not found in registry`);
    }

    const config = JSON.parse(row.config) as ServerConfig;
    const client = new Client(
      { name: "humanoms", version: "0.1.0" },
      { capabilities: {} }
    );

    if (row.transport === "stdio") {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });

      await client.connect(transport);
      log.info({ server: serverName }, "Connected to MCP server");
    } else {
      throw new Error(`Unsupported transport: ${row.transport}`);
    }

    this.clients.set(serverName, client);

    this.db
      .query(
        "UPDATE tool_registry SET health_status = 'healthy', last_health_check = datetime('now') WHERE name = ?"
      )
      .run(serverName);

    return client;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = await this.getClient(serverName);

    log.info({ server: serverName, tool: toolName }, "Calling MCP tool");

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  }

  async listTools(serverName: string): Promise<string[]> {
    const client = await this.getClient(serverName);
    const result = await client.listTools();
    return result.tools.map((t) => t.name);
  }

  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);
      log.info({ server: serverName }, "Disconnected from MCP server");
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
      } catch (err) {
        log.error(
          { server: name, err: (err as Error).message },
          "Error disconnecting"
        );
      }
    }
    this.clients.clear();
  }

  getRegisteredServers(): ToolRegistryRow[] {
    return this.db
      .query<ToolRegistryRow, []>("SELECT * FROM tool_registry ORDER BY name")
      .all();
  }
}
