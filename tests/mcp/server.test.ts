import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/db/schema.ts";
import { createMcpServer } from "../../src/mcp/server.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredToolEntry = {
  handler: (
    args: Record<string, unknown>,
    extra: unknown
  ) => Promise<ToolResult>;
};

type ToolsRecord = Record<string, RegisteredToolEntry>;

/**
 * Helper to call a tool on the MCP server by invoking the handler directly.
 * We access the internal _registeredTools object to call handlers in-process
 * without needing a transport connection.
 */
async function callTool(
  server: ReturnType<typeof createMcpServer>,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  const registeredTools = (
    server as unknown as { _registeredTools: ToolsRecord }
  )._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" not found`);
  }
  const extra = { signal: new AbortController().signal };
  return await tool.handler(args, extra);
}

function getToolNames(server: ReturnType<typeof createMcpServer>): string[] {
  const registeredTools = (
    server as unknown as { _registeredTools: ToolsRecord }
  )._registeredTools;
  return Object.keys(registeredTools);
}

/** Extract the first text content from a tool result, parsed as JSON. */
function parseResult(result: ToolResult): Record<string, unknown> {
  const first = result.content[0]!;
  return JSON.parse(first.text) as Record<string, unknown>;
}

/** Extract the first text content from a tool result, parsed as a JSON array. */
function parseResultArray(result: ToolResult): Record<string, unknown>[] {
  const first = result.content[0]!;
  return JSON.parse(first.text) as Record<string, unknown>[];
}

describe("MCP Server", () => {
  let db: Database;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(() => {
    db = createTestDb();
    server = createMcpServer(db);
  });

  describe("server setup", () => {
    test("creates server with expected tools registered", () => {
      const toolNames = getToolNames(server);
      expect(toolNames.length).toBeGreaterThanOrEqual(16);

      // Task tools
      expect(toolNames).toContain("create_task");
      expect(toolNames).toContain("list_tasks");
      expect(toolNames).toContain("get_task");
      expect(toolNames).toContain("update_task");
      expect(toolNames).toContain("complete_task");

      // Entity tools
      expect(toolNames).toContain("create_entity");
      expect(toolNames).toContain("list_entities");
      expect(toolNames).toContain("get_entity");
      expect(toolNames).toContain("update_entity");
      expect(toolNames).toContain("search_entities");

      // Workflow tools
      expect(toolNames).toContain("create_workflow");
      expect(toolNames).toContain("list_workflows");
      expect(toolNames).toContain("trigger_workflow");
      expect(toolNames).toContain("get_job_status");

      // System tools
      expect(toolNames).toContain("system_status");
      expect(toolNames).toContain("query_audit_log");
    });
  });

  describe("task tools", () => {
    test("create_task creates a task and returns it", async () => {
      const result = await callTool(server, "create_task", {
        title: "Test task",
        description: "A test description",
        priority: 2,
        tags: ["test", "mcp"],
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const task = parseResult(result);
      expect(task.title).toBe("Test task");
      expect(task.description).toBe("A test description");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe(2);
      expect(task.tags).toEqual(["test", "mcp"]);
      expect(task.id).toBeDefined();
    });

    test("list_tasks returns created tasks", async () => {
      await callTool(server, "create_task", { title: "Task 1" });
      await callTool(server, "create_task", { title: "Task 2" });

      const result = await callTool(server, "list_tasks", {});
      const tasks = parseResultArray(result);
      expect(tasks).toHaveLength(2);
    });

    test("list_tasks filters by status", async () => {
      await callTool(server, "create_task", {
        title: "Pending task",
        status: "pending",
      });
      await callTool(server, "create_task", {
        title: "Completed task",
        status: "completed",
      });

      const result = await callTool(server, "list_tasks", {
        status: "pending",
      });
      const tasks = parseResultArray(result);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Pending task");
    });

    test("get_task returns a specific task", async () => {
      const createResult = await callTool(server, "create_task", {
        title: "Find me",
      });
      const created = parseResult(createResult);

      const result = await callTool(server, "get_task", {
        id: created.id as string,
      });
      const task = parseResult(result);
      expect(task.title).toBe("Find me");
    });

    test("get_task returns error for nonexistent ID", async () => {
      const result = await callTool(server, "get_task", { id: "nonexistent" });
      expect(result.isError).toBe(true);
      const body = parseResult(result);
      expect(body.error).toBe("Task not found");
    });

    test("update_task updates fields", async () => {
      const createResult = await callTool(server, "create_task", {
        title: "Original",
      });
      const created = parseResult(createResult);

      const result = await callTool(server, "update_task", {
        id: created.id as string,
        title: "Updated",
        priority: 3,
      });
      const updated = parseResult(result);
      expect(updated.title).toBe("Updated");
      expect(updated.priority).toBe(3);
    });

    test("complete_task sets status to completed", async () => {
      const createResult = await callTool(server, "create_task", {
        title: "Complete me",
      });
      const created = parseResult(createResult);

      const result = await callTool(server, "complete_task", {
        id: created.id as string,
      });
      const completed = parseResult(result);
      expect(completed.status).toBe("completed");
    });
  });

  describe("entity tools", () => {
    test("create_entity creates an entity and returns it", async () => {
      const result = await callTool(server, "create_entity", {
        type: "person",
        name: "John Doe",
        properties: { email: "john@example.com" },
        tags: ["contact"],
      });

      const entity = parseResult(result);
      expect(entity.type).toBe("person");
      expect(entity.name).toBe("John Doe");
      expect(
        (entity.properties as Record<string, unknown>).email
      ).toBe("john@example.com");
      expect(entity.tags).toEqual(["contact"]);
      expect(entity.id).toBeDefined();
    });

    test("list_entities returns created entities", async () => {
      await callTool(server, "create_entity", {
        type: "person",
        name: "Alice",
      });
      await callTool(server, "create_entity", {
        type: "project",
        name: "HumanOMS",
      });

      const result = await callTool(server, "list_entities", {});
      const entities = parseResultArray(result);
      expect(entities).toHaveLength(2);
    });

    test("list_entities filters by type", async () => {
      await callTool(server, "create_entity", {
        type: "person",
        name: "Alice",
      });
      await callTool(server, "create_entity", {
        type: "project",
        name: "HumanOMS",
      });

      const result = await callTool(server, "list_entities", {
        type: "person",
      });
      const entities = parseResultArray(result);
      expect(entities).toHaveLength(1);
      expect(entities[0]!.name).toBe("Alice");
    });

    test("get_entity returns a specific entity", async () => {
      const createResult = await callTool(server, "create_entity", {
        type: "person",
        name: "Bob",
      });
      const created = parseResult(createResult);

      const result = await callTool(server, "get_entity", {
        id: created.id as string,
      });
      const entity = parseResult(result);
      expect(entity.name).toBe("Bob");
    });

    test("get_entity returns error for nonexistent ID", async () => {
      const result = await callTool(server, "get_entity", {
        id: "nonexistent",
      });
      expect(result.isError).toBe(true);
    });

    test("update_entity updates fields", async () => {
      const createResult = await callTool(server, "create_entity", {
        type: "person",
        name: "Original Name",
      });
      const created = parseResult(createResult);

      const result = await callTool(server, "update_entity", {
        id: created.id as string,
        name: "Updated Name",
        tags: ["updated"],
      });
      const updated = parseResult(result);
      expect(updated.name).toBe("Updated Name");
      expect(updated.tags).toEqual(["updated"]);
    });

    test("search_entities finds entities via FTS", async () => {
      await callTool(server, "create_entity", {
        type: "person",
        name: "Alice Wonderland",
      });
      await callTool(server, "create_entity", {
        type: "person",
        name: "Bob Builder",
      });

      const result = await callTool(server, "search_entities", {
        query: "Alice",
      });
      const entities = parseResultArray(result);
      expect(entities).toHaveLength(1);
      expect(entities[0]!.name).toBe("Alice Wonderland");
    });
  });

  describe("workflow tools", () => {
    test("create_workflow creates a workflow", async () => {
      const result = await callTool(server, "create_workflow", {
        name: "Test Workflow",
        description: "A test workflow",
        steps: [{ name: "step1", action: "do_something" }],
      });

      const workflow = parseResult(result);
      expect(workflow.name).toBe("Test Workflow");
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.id).toBeDefined();
    });

    test("list_workflows returns all workflows", async () => {
      await callTool(server, "create_workflow", {
        name: "WF1",
        steps: [{ name: "s1", action: "a1" }],
      });
      await callTool(server, "create_workflow", {
        name: "WF2",
        steps: [{ name: "s2", action: "a2" }],
      });

      const result = await callTool(server, "list_workflows", {});
      const workflows = parseResultArray(result);
      expect(workflows).toHaveLength(2);
    });

    test("trigger_workflow creates a queued job", async () => {
      const wfResult = await callTool(server, "create_workflow", {
        name: "Trigger Test",
        steps: [{ name: "s1", action: "a1" }],
      });
      const workflow = parseResult(wfResult);

      const result = await callTool(server, "trigger_workflow", {
        workflow_id: workflow.id as string,
        input: { key: "value" },
      });

      const job = parseResult(result);
      expect(job.status).toBe("queued");
      expect(job.workflow_id).toBe(workflow.id);
      expect((job.input as Record<string, unknown>).key).toBe("value");
    });

    test("get_job_status returns job details", async () => {
      const wfResult = await callTool(server, "create_workflow", {
        name: "Job Status Test",
        steps: [{ name: "s1", action: "a1" }],
      });
      const workflow = parseResult(wfResult);

      const triggerResult = await callTool(server, "trigger_workflow", {
        workflow_id: workflow.id as string,
      });
      const job = parseResult(triggerResult);

      const result = await callTool(server, "get_job_status", {
        job_id: job.id as string,
      });
      const retrieved = parseResult(result);
      expect(retrieved.id).toBe(job.id);
      expect(retrieved.status).toBe("queued");
    });

    test("trigger_workflow returns error for nonexistent workflow", async () => {
      const result = await callTool(server, "trigger_workflow", {
        workflow_id: "nonexistent",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("system tools", () => {
    test("system_status returns health info", async () => {
      const result = await callTool(server, "system_status", {});
      const status = parseResult(result);

      expect(status.version).toBe("0.1.0");
      expect(status.uptime_seconds).toBeGreaterThanOrEqual(0);
      const counts = status.counts as Record<string, unknown>;
      expect(counts.tasks).toBe(0);
      expect(counts.entities).toBe(0);
      expect(counts.workflows).toBe(0);
      expect((counts.jobs as Record<string, unknown>).total).toBe(0);
    });

    test("system_status reflects counts after creating data", async () => {
      await callTool(server, "create_task", { title: "Task 1" });
      await callTool(server, "create_entity", {
        type: "person",
        name: "Alice",
      });

      const result = await callTool(server, "system_status", {});
      const status = parseResult(result);
      const counts = status.counts as Record<string, unknown>;
      expect(counts.tasks).toBe(1);
      expect(counts.entities).toBe(1);
    });

    test("query_audit_log returns empty when no logs", async () => {
      const result = await callTool(server, "query_audit_log", {});
      const logs = parseResultArray(result);
      expect(logs).toEqual([]);
    });

    test("query_audit_log filters by actor", async () => {
      db.run(
        "INSERT INTO audit_log (id, actor, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)",
        ["log1", "system", "create", "task", "t1", "{}"]
      );
      db.run(
        "INSERT INTO audit_log (id, actor, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)",
        ["log2", "user", "update", "task", "t1", "{}"]
      );

      const result = await callTool(server, "query_audit_log", {
        actor: "system",
      });
      const logs = parseResultArray(result);
      expect(logs).toHaveLength(1);
      expect(logs[0]!.actor).toBe("system");
    });
  });
});
