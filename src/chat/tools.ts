import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { generateId } from "../lib/ulid.ts";
import type { JobQueue } from "../jobs/queue.ts";
import type { Scheduler } from "../scheduler/scheduler.ts";
import {
  validateShellCommand,
  validateFilePath,
  validateUrlNotSSRF,
  TASK_COLUMN_ALLOWLIST,
  ENTITY_COLUMN_ALLOWLIST,
} from "../security/sandbox.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function jsonError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function deserializeTask(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    tags: JSON.parse((r.tags as string) || "[]"),
    metadata: JSON.parse((r.metadata as string) || "{}"),
  };
}

function deserializeEntity(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    properties: JSON.parse((r.properties as string) || "{}"),
    tags: JSON.parse((r.tags as string) || "[]"),
  };
}

function deserializeWorkflow(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    steps: JSON.parse((r.steps as string) || "[]"),
  };
}

function deserializeJob(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    input: JSON.parse((r.input as string) || "{}"),
    context: JSON.parse((r.context as string) || "{}"),
    output: r.output ? JSON.parse(r.output as string) : null,
  };
}

function deserializeAutomation(row: unknown): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    input: JSON.parse((r.input as string) || "{}"),
    enabled: r.enabled === 1,
  };
}

// ── Tool builder ─────────────────────────────────────────────────────────

export function buildChatTools(
  db: Database,
  jobQueue?: JobQueue,
  scheduler?: Scheduler
): SdkMcpToolDefinition[] {
  // Each tool() call returns SdkMcpToolDefinition<T> which is covariant with the base type at runtime
  const tools: any[] = [
    // ── Tasks ──────────────────────────────────────────────────────────

    tool(
      "list_tasks",
      "List tasks with optional filters by status, tag, or due date",
      {
        status: z
          .enum(["pending", "in_progress", "completed", "cancelled"])
          .optional(),
        tags: z.string().optional(),
        due_before: z.string().optional(),
      },
      async (params) => {
        let sql = "SELECT * FROM tasks";
        const conditions: string[] = [];
        const sqlParams: SQLQueryBindings[] = [];

        if (params.status) {
          conditions.push("status = ?");
          sqlParams.push(params.status);
        }
        if (params.tags) {
          conditions.push("tags LIKE ?");
          sqlParams.push(`%"${params.tags}"%`);
        }
        if (params.due_before) {
          conditions.push("due_date <= ?");
          sqlParams.push(params.due_before);
        }
        if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
        sql += " ORDER BY created_at DESC";

        const rows = db.query(sql).all(...sqlParams) as Record<string, unknown>[];
        return json(rows.map(deserializeTask));
      }
    ),

    tool(
      "create_task",
      "Create a new task",
      {
        title: z.string().min(1).max(500),
        description: z.string().max(10000).optional(),
        status: z
          .enum(["pending", "in_progress", "completed", "cancelled"])
          .optional(),
        priority: z.number().int().min(0).max(4).optional(),
        due_date: z.string().optional(),
        recurrence: z.string().max(100).optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      async (params) => {
        const id = generateId();
        const now = new Date().toISOString();
        db.run(
          `INSERT INTO tasks (id, title, description, status, priority, due_date, recurrence, tags, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            params.title,
            params.description ?? null,
            params.status ?? "pending",
            params.priority ?? 0,
            params.due_date ?? null,
            params.recurrence ?? null,
            JSON.stringify(params.tags ?? []),
            JSON.stringify(params.metadata ?? {}),
            now,
            now,
          ]
        );
        const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
        return json(deserializeTask(row));
      }
    ),

    tool(
      "get_task",
      "Get a task by ID",
      { id: z.string().min(1) },
      async (params) => {
        const row = db.query("SELECT * FROM tasks WHERE id = ?").get(params.id);
        if (!row) return jsonError("Task not found");
        return json(deserializeTask(row));
      }
    ),

    tool(
      "update_task",
      "Update an existing task",
      {
        id: z.string().min(1),
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(10000).optional(),
        status: z
          .enum(["pending", "in_progress", "completed", "cancelled"])
          .optional(),
        priority: z.number().int().min(0).max(4).optional(),
        due_date: z.string().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      async (params) => {
        const existing = db
          .query("SELECT * FROM tasks WHERE id = ?")
          .get(params.id);
        if (!existing) return jsonError("Task not found");

        const sets: string[] = ["updated_at = ?"];
        const values: SQLQueryBindings[] = [new Date().toISOString()];

        const { id, ...updates } = params;
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined && TASK_COLUMN_ALLOWLIST.has(key)) {
            sets.push(`${key} = ?`);
            values.push(
              key === "tags" || key === "metadata"
                ? JSON.stringify(value)
                : (value as SQLQueryBindings)
            );
          }
        }
        values.push(id);
        db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
        const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
        return json(deserializeTask(row));
      }
    ),

    tool(
      "complete_task",
      "Mark a task as completed",
      { id: z.string().min(1) },
      async (params) => {
        const existing = db
          .query("SELECT * FROM tasks WHERE id = ?")
          .get(params.id);
        if (!existing) return jsonError("Task not found");

        const now = new Date().toISOString();
        db.run(
          `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?`,
          [now, params.id]
        );
        const row = db.query("SELECT * FROM tasks WHERE id = ?").get(params.id);
        return json(deserializeTask(row));
      }
    ),

    tool(
      "delete_task",
      "Delete one or more tasks by ID.",
      { task_ids: z.array(z.string().min(1)).min(1) },
      async (params) => {
        const deleted: string[] = [];
        for (const id of params.task_ids) {
          const existing = db.query("SELECT id FROM tasks WHERE id = ?").get(id);
          if (!existing) continue;
          db.run("DELETE FROM tasks WHERE id = ?", [id]);
          deleted.push(id);
        }
        return json({ deleted_count: deleted.length, deleted_ids: deleted });
      }
    ),

    // ── Entities ───────────────────────────────────────────────────────

    tool(
      "list_entities",
      "List entities with optional filters by type or tag",
      {
        type: z.string().optional(),
        tags: z.string().optional(),
      },
      async (params) => {
        let sql = "SELECT * FROM entities";
        const conditions: string[] = [];
        const sqlParams: SQLQueryBindings[] = [];

        if (params.type) {
          conditions.push("type = ?");
          sqlParams.push(params.type);
        }
        if (params.tags) {
          conditions.push("tags LIKE ?");
          sqlParams.push(`%"${params.tags}"%`);
        }
        if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
        sql += " ORDER BY created_at DESC";

        const rows = db.query(sql).all(...sqlParams) as Record<string, unknown>[];
        return json(rows.map(deserializeEntity));
      }
    ),

    tool(
      "create_entity",
      "Create a new entity",
      {
        type: z.string().min(1).max(100),
        name: z.string().min(1).max(500),
        properties: z.record(z.string(), z.unknown()).optional(),
        tags: z.array(z.string()).optional(),
        parent_id: z.string().optional(),
        source_id: z.string().optional(),
      },
      async (params) => {
        const id = generateId();
        const now = new Date().toISOString();
        db.run(
          `INSERT INTO entities (id, type, name, properties, tags, parent_id, source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            params.type,
            params.name,
            JSON.stringify(params.properties ?? {}),
            JSON.stringify(params.tags ?? []),
            params.parent_id ?? null,
            params.source_id ?? null,
            now,
            now,
          ]
        );
        const row = db.query("SELECT * FROM entities WHERE id = ?").get(id);
        return json(deserializeEntity(row));
      }
    ),

    tool(
      "search_entities",
      "Full-text search entities using FTS5",
      { query: z.string().min(1) },
      async (params) => {
        const rows = db
          .query(
            `SELECT e.* FROM entities e
             JOIN entities_fts fts ON e.rowid = fts.rowid
             WHERE entities_fts MATCH ?
             ORDER BY rank`
          )
          .all(params.query) as Record<string, unknown>[];
        return json(rows.map(deserializeEntity));
      }
    ),

    tool(
      "get_entity",
      "Get a single entity by ID",
      { id: z.string().min(1) },
      async (params) => {
        const row = db.query("SELECT * FROM entities WHERE id = ?").get(params.id);
        if (!row) return jsonError("Entity not found");
        return json(deserializeEntity(row));
      }
    ),

    tool(
      "update_entity",
      "Update an existing entity's name, type, properties, or tags",
      {
        id: z.string().min(1),
        name: z.string().min(1).max(500).optional(),
        type: z.string().min(1).max(100).optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        tags: z.array(z.string()).optional(),
      },
      async (params) => {
        const existing = db.query("SELECT * FROM entities WHERE id = ?").get(params.id);
        if (!existing) return jsonError("Entity not found");

        const sets: string[] = ["updated_at = ?"];
        const values: SQLQueryBindings[] = [new Date().toISOString()];
        const { id, ...updates } = params;
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined && ENTITY_COLUMN_ALLOWLIST.has(key)) {
            sets.push(`${key} = ?`);
            values.push(
              key === "properties" || key === "tags"
                ? JSON.stringify(value)
                : (value as SQLQueryBindings)
            );
          }
        }
        values.push(id);
        db.run(`UPDATE entities SET ${sets.join(", ")} WHERE id = ?`, values);
        const row = db.query("SELECT * FROM entities WHERE id = ?").get(id);
        return json(deserializeEntity(row));
      }
    ),

    tool(
      "delete_entity",
      "Delete one or more entities by ID.",
      { entity_ids: z.array(z.string().min(1)).min(1) },
      async (params) => {
        const deleted: string[] = [];
        for (const id of params.entity_ids) {
          const existing = db.query("SELECT id FROM entities WHERE id = ?").get(id);
          if (!existing) continue;
          db.run("DELETE FROM entities WHERE id = ?", [id]);
          deleted.push(id);
        }
        return json({ deleted_count: deleted.length, deleted_ids: deleted });
      }
    ),

    // ── Workflows ──────────────────────────────────────────────────────

    tool(
      "create_workflow",
      "Create a new workflow with a sequence of steps. Each step MUST have: tool (the tool name like list_tasks, llm_generate, create_task, etc.), server (always 'humanoms' for built-in tools), trust_level ('auto' for safe ops, 'approve' for destructive/costly ops that need Discord approval, 'notify' for info-only). Optionally: name (display name), input (object passed to tool), output_mapping, on_failure ('abort'|'skip'|'retry').",
      {
        name: z.string().min(1),
        description: z.string().optional(),
        steps: z.array(z.object({
          name: z.string().optional(),
          tool: z.string(),
          server: z.string().default("humanoms"),
          input: z.record(z.string(), z.unknown()).optional().default({}),
          trust_level: z.enum(["auto", "approve", "notify"]).default("auto"),
          output_mapping: z.record(z.string(), z.string()).optional(),
          on_failure: z.enum(["abort", "skip", "retry"]).optional(),
        })).min(1),
      },
      async (params) => {
        const id = generateId();
        const now = new Date().toISOString();
        db.run(
          `INSERT INTO workflows (id, name, description, steps, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            params.name,
            params.description ?? null,
            JSON.stringify(params.steps),
            now,
            now,
          ]
        );
        const row = db.query("SELECT * FROM workflows WHERE id = ?").get(id);
        return json(deserializeWorkflow(row));
      }
    ),

    tool(
      "list_workflows",
      "List workflows. Use name_search to find a specific workflow by name instead of listing all.",
      {
        name_search: z.string().optional(),
      },
      async (params) => {
        if (params.name_search) {
          const rows = db
            .query("SELECT * FROM workflows WHERE name LIKE ? ORDER BY created_at DESC")
            .all(`%${params.name_search}%`) as Record<string, unknown>[];
          return json(rows.map(deserializeWorkflow));
        }
        const rows = db
          .query("SELECT * FROM workflows ORDER BY created_at DESC")
          .all() as Record<string, unknown>[];
        return json(rows.map(deserializeWorkflow));
      }
    ),

    tool(
      "get_workflow",
      "Get a single workflow by ID",
      { workflow_id: z.string().min(1) },
      async (params) => {
        const row = db.query("SELECT * FROM workflows WHERE id = ?").get(params.workflow_id);
        if (!row) return jsonError("Workflow not found");
        return json(deserializeWorkflow(row));
      }
    ),

    tool(
      "update_workflow",
      "Update an existing workflow's name, description, or steps. Same step schema as create_workflow.",
      {
        workflow_id: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        steps: z.array(z.object({
          name: z.string().optional(),
          tool: z.string(),
          server: z.string().default("humanoms"),
          input: z.record(z.string(), z.unknown()).optional().default({}),
          trust_level: z.enum(["auto", "approve", "notify"]).default("auto"),
          output_mapping: z.record(z.string(), z.string()).optional(),
          on_failure: z.enum(["abort", "skip", "retry"]).optional(),
        })).min(1).optional(),
      },
      async (params) => {
        const existing = db
          .query("SELECT * FROM workflows WHERE id = ?")
          .get(params.workflow_id);
        if (!existing) return jsonError("Workflow not found");

        const sets: string[] = ["updated_at = ?"];
        const values: SQLQueryBindings[] = [new Date().toISOString()];

        if (params.name) { sets.push("name = ?"); values.push(params.name); }
        if (params.description !== undefined) { sets.push("description = ?"); values.push(params.description); }
        if (params.steps) { sets.push("steps = ?"); values.push(JSON.stringify(params.steps)); }

        values.push(params.workflow_id);
        db.run(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ?`, values);
        const row = db.query("SELECT * FROM workflows WHERE id = ?").get(params.workflow_id);
        return json(deserializeWorkflow(row));
      }
    ),

    tool(
      "delete_workflow",
      "Delete one or more workflows by ID. Cascade-deletes linked jobs and automations. Pass a single ID or multiple IDs.",
      {
        workflow_ids: z.array(z.string().min(1)).min(1),
      },
      async (params) => {
        const deleted: string[] = [];
        for (const id of params.workflow_ids) {
          const existing = db.query("SELECT * FROM workflows WHERE id = ?").get(id);
          if (!existing) continue;
          db.run("DELETE FROM approvals WHERE job_id IN (SELECT id FROM jobs WHERE workflow_id = ?)", [id]);
          db.run("DELETE FROM jobs WHERE workflow_id = ?", [id]);
          db.run("DELETE FROM automations WHERE workflow_id = ?", [id]);
          db.run("DELETE FROM workflows WHERE id = ?", [id]);
          deleted.push(id);
        }
        return json({ deleted_count: deleted.length, deleted_ids: deleted });
      }
    ),

    tool(
      "trigger_workflow",
      "Trigger a workflow and create a queued job",
      {
        workflow_id: z.string().min(1),
        input: z.record(z.string(), z.unknown()).optional(),
      },
      async (params) => {
        const workflow = db
          .query("SELECT * FROM workflows WHERE id = ?")
          .get(params.workflow_id);
        if (!workflow) return jsonError("Workflow not found");

        const jobId = generateId();
        const now = new Date().toISOString();
        const input = params.input ?? {};

        db.run(
          `INSERT INTO jobs (id, workflow_id, status, current_step, input, context, retries, max_retries, created_at)
           VALUES (?, ?, 'queued', 0, ?, '{}', 0, 3, ?)`,
          [jobId, params.workflow_id, JSON.stringify(input), now]
        );

        const row = db.query("SELECT * FROM jobs WHERE id = ?").get(jobId);
        return json(deserializeJob(row));
      }
    ),

    // ── Jobs ───────────────────────────────────────────────────────────

    tool(
      "list_jobs",
      "List jobs with optional status filter",
      {
        status: z.string().optional(),
      },
      async (params) => {
        let sql = "SELECT * FROM jobs";
        const sqlParams: SQLQueryBindings[] = [];
        if (params.status) {
          sql += " WHERE status = ?";
          sqlParams.push(params.status);
        }
        sql += " ORDER BY created_at DESC";
        const rows = db.query(sql).all(...sqlParams) as Record<string, unknown>[];
        return json(rows.map(deserializeJob));
      }
    ),

    tool(
      "get_job",
      "Get job details by ID",
      { job_id: z.string().min(1) },
      async (params) => {
        const row = db
          .query("SELECT * FROM jobs WHERE id = ?")
          .get(params.job_id);
        if (!row) return jsonError("Job not found");
        return json(deserializeJob(row));
      }
    ),

    tool(
      "delete_job",
      "Delete one or more jobs by ID. Also deletes linked approvals.",
      { job_ids: z.array(z.string().min(1)).min(1) },
      async (params) => {
        const deleted: string[] = [];
        for (const id of params.job_ids) {
          const existing = db.query("SELECT id FROM jobs WHERE id = ?").get(id);
          if (!existing) continue;
          db.run("DELETE FROM approvals WHERE job_id = ?", [id]);
          db.run("DELETE FROM jobs WHERE id = ?", [id]);
          deleted.push(id);
        }
        return json({ deleted_count: deleted.length, deleted_ids: deleted });
      }
    ),

    // ── Files ──────────────────────────────────────────────────────────

    tool(
      "list_files",
      "List files tracked in the database, optionally filtered by MIME type",
      {
        mime_type: z.string().optional(),
      },
      async (params) => {
        let sql = "SELECT * FROM files";
        const sqlParams: SQLQueryBindings[] = [];
        if (params.mime_type) {
          sql += " WHERE mime_type = ?";
          sqlParams.push(params.mime_type);
        }
        sql += " ORDER BY created_at DESC";
        const rows = db.query(sql).all(...sqlParams) as Record<string, unknown>[];
        return json(rows);
      }
    ),

    tool(
      "read_file",
      "Read the text content of a local file by path",
      {
        path: z.string().min(1),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
        max_chars: z.number().int().min(1).optional(),
      },
      async (params) => {
        validateFilePath(params.path);
        if (!existsSync(params.path))
          return jsonError(`File not found: ${params.path}`);

        const content = readFileSync(params.path, "utf-8");

        if (params.start_line || params.end_line) {
          const lines = content.split("\n");
          const start = (params.start_line || 1) - 1;
          const end = params.end_line || lines.length;
          return json({
            content: lines.slice(start, end).join("\n"),
            total_lines: lines.length,
          });
        }

        if (params.max_chars && content.length > params.max_chars) {
          return json({
            content: content.slice(0, params.max_chars),
            truncated: true,
            total_length: content.length,
          });
        }

        return json({ content, length: content.length });
      }
    ),

    tool(
      "web_fetch",
      "Fetch a URL and return its text content",
      {
        url: z.string().url(),
        max_chars: z.number().int().min(1).optional(),
      },
      async (params) => {
        await validateUrlNotSSRF(params.url);
        const res = await fetch(params.url);
        if (!res.ok)
          return jsonError(`HTTP ${res.status} for ${params.url}`);

        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();

        if (params.max_chars && text.length > params.max_chars) {
          return json({
            content: text.slice(0, params.max_chars),
            truncated: true,
            total_length: text.length,
            content_type: contentType,
          });
        }

        return json({ content: text, length: text.length, content_type: contentType });
      }
    ),

    // ── File writing ──────────────────────────────────────────────────

    tool(
      "write_file",
      "Write content to a file on disk. Creates parent directories if needed.",
      {
        path: z.string().min(1),
        content: z.string(),
      },
      async (params) => {
        validateFilePath(params.path);
        mkdirSync(dirname(params.path), { recursive: true });
        writeFileSync(params.path, params.content, "utf-8");
        return json({ path: params.path, length: params.content.length });
      }
    ),

    // ── Shell command ─────────────────────────────────────────────────

    tool(
      "shell_command",
      "Run a shell command. Use for git operations, gh CLI, and other system commands. Returns stdout, stderr, and exit_code.",
      {
        command: z.string().min(1),
        cwd: z.string().optional(),
      },
      async (params) => {
        validateShellCommand(params.command);
        const proc = Bun.spawn(["sh", "-c", params.command], {
          cwd: params.cwd || undefined,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        return json({
          stdout: stdout.slice(0, 10000),
          stderr: stderr.slice(0, 5000),
          exit_code: exitCode,
        });
      }
    ),

    // ── System ─────────────────────────────────────────────────────────

    tool(
      "system_status",
      "Get the current system status including task and entity counts",
      {},
      async () => {
        const taskCount = (
          db.query("SELECT COUNT(*) as c FROM tasks").get() as any
        ).c;
        const entityCount = (
          db.query("SELECT COUNT(*) as c FROM entities").get() as any
        ).c;
        const jobCount = (
          db.query("SELECT COUNT(*) as c FROM jobs").get() as any
        ).c;
        const workflowCount = (
          db.query("SELECT COUNT(*) as c FROM workflows").get() as any
        ).c;
        return json({
          status: "running",
          uptime: process.uptime(),
          version: "0.1.0",
          tasks: taskCount,
          entities: entityCount,
          jobs: jobCount,
          workflows: workflowCount,
        });
      }
    ),

    // ── Automations ────────────────────────────────────────────────────

    tool(
      "create_automation",
      "Create a scheduled automation that triggers a workflow on a cron schedule",
      {
        name: z.string().min(1),
        description: z.string().optional(),
        cron_expression: z.string().min(1),
        workflow_id: z.string().min(1),
        input: z.record(z.string(), z.unknown()).optional(),
        enabled: z.boolean().optional(),
      },
      async (params) => {
        const workflow = db
          .query("SELECT * FROM workflows WHERE id = ?")
          .get(params.workflow_id);
        if (!workflow) return jsonError("Workflow not found");

        const id = generateId();
        const now = new Date().toISOString();
        db.run(
          `INSERT INTO automations (id, name, description, cron_expression, workflow_id, input, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            params.name,
            params.description ?? null,
            params.cron_expression,
            params.workflow_id,
            JSON.stringify(params.input ?? {}),
            (params.enabled ?? true) ? 1 : 0,
            now,
          ]
        );
        const row = db.query("SELECT * FROM automations WHERE id = ?").get(id) as any;
        // Live-schedule the automation so it runs without server restart
        if (scheduler && row && row.enabled === 1) {
          scheduler.schedule(row);
        }
        return json(deserializeAutomation(row));
      }
    ),

    tool(
      "list_automations",
      "List all scheduled automations",
      {
        enabled: z.boolean().optional(),
      },
      async (params) => {
        let sql = "SELECT * FROM automations";
        const sqlParams: SQLQueryBindings[] = [];
        if (params.enabled !== undefined) {
          sql += " WHERE enabled = ?";
          sqlParams.push(params.enabled ? 1 : 0);
        }
        sql += " ORDER BY created_at DESC";
        const rows = db.query(sql).all(...sqlParams) as Record<string, unknown>[];
        return json(rows.map(deserializeAutomation));
      }
    ),
    tool(
      "update_automation",
      "Update an automation's name, description, cron_expression, or enabled status.",
      {
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        cron_expression: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
      },
      async (params) => {
        const existing = db.query("SELECT * FROM automations WHERE id = ?").get(params.id);
        if (!existing) return jsonError("Automation not found");

        const sets: string[] = [];
        const values: SQLQueryBindings[] = [];
        if (params.name) { sets.push("name = ?"); values.push(params.name); }
        if (params.description !== undefined) { sets.push("description = ?"); values.push(params.description); }
        if (params.cron_expression) { sets.push("cron_expression = ?"); values.push(params.cron_expression); }
        if (params.enabled !== undefined) { sets.push("enabled = ?"); values.push(params.enabled ? 1 : 0); }
        if (sets.length === 0) return jsonError("No fields to update");

        values.push(params.id);
        db.run(`UPDATE automations SET ${sets.join(", ")} WHERE id = ?`, values);
        const row = db.query("SELECT * FROM automations WHERE id = ?").get(params.id) as any;
        if (scheduler && row) {
          if (row.enabled === 1) scheduler.schedule(row);
          else scheduler.unschedule(params.id);
        }
        return json(deserializeAutomation(row));
      }
    ),

    tool(
      "delete_automation",
      "Delete one or more automations by ID.",
      { automation_ids: z.array(z.string().min(1)).min(1) },
      async (params) => {
        const deleted: string[] = [];
        for (const id of params.automation_ids) {
          const existing = db.query("SELECT id FROM automations WHERE id = ?").get(id);
          if (!existing) continue;
          db.run("DELETE FROM automations WHERE id = ?", [id]);
          if (scheduler) scheduler.unschedule(id);
          deleted.push(id);
        }
        return json({ deleted_count: deleted.length, deleted_ids: deleted });
      }
    ),
  ];
  return tools;
}
