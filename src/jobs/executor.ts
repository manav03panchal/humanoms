import type { Database, SQLQueryBindings } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { createChildLogger } from "../lib/logger.ts";
import { interpolateObject } from "../lib/template.ts";
import { JobQueue } from "./queue.ts";
import type { Job } from "./queue.ts";
import { PipelineContext } from "./context.ts";
import { ApprovalManager } from "./approval.ts";
import { McpClientPool } from "../mcp/client/pool.ts";
import { NotificationDispatcher } from "../notifications/dispatcher.ts";
import { generateId } from "../lib/ulid.ts";
import {
  validateShellCommand,
  validateFilePath,
  validateUrlNotSSRF,
  TASK_COLUMN_ALLOWLIST,
  ENTITY_COLUMN_ALLOWLIST,
} from "../security/sandbox.ts";

const log = createChildLogger("executor");

interface WorkflowStep {
  name?: string;
  tool: string;
  server: string;
  input: Record<string, unknown>;
  trust_level?: "auto" | "approve" | "notify";
  output_mapping?: Record<string, string>;
  on_failure?: "abort" | "skip" | "retry";
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  steps: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

type ToolHandler = (
  db: Database,
  input: Record<string, unknown>
) => Promise<Record<string, unknown>>;

/**
 * Built-in tool handlers for the "humanoms" server.
 * These execute directly against the database without spawning an MCP subprocess.
 */
function buildInternalTools(
  db: Database
): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();

  // ── Task tools ───────────────────────────────────────────────────────
  tools.set("list_tasks", async (_db, input) => {
    let sql = "SELECT * FROM tasks";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (input.status) {
      conditions.push("status = ?");
      params.push(input.status as string);
    }
    if (input.tags) {
      conditions.push("tags LIKE ?");
      params.push(`%"${input.tags}"%`);
    }
    if (input.due_before) {
      conditions.push("due_date <= ?");
      params.push(input.due_before as string);
    }
    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC";

    const rows = _db.query(sql).all(...params) as Record<string, unknown>[];
    return { tasks: rows.map(deserializeTask) };
  });

  tools.set("create_task", async (_db, input) => {
    const id = generateId();
    const now = new Date().toISOString();
    _db.run(
      `INSERT INTO tasks (id, title, description, status, priority, due_date, recurrence, tags, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        (input.title as string) || "Untitled",
        (input.description as string) ?? null,
        (input.status as string) ?? "pending",
        (input.priority as number) ?? 0,
        (input.due_date as string) ?? null,
        (input.recurrence as string) ?? null,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ]
    );
    const row = _db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    return { task: deserializeTask(row) };
  });

  tools.set("get_task", async (_db, input) => {
    const row = _db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(input.id as string);
    if (!row) return { error: "Task not found" };
    return { task: deserializeTask(row) };
  });

  tools.set("update_task", async (_db, input) => {
    const { id, ...updates } = input;
    const sets: string[] = ["updated_at = ?"];
    const values: SQLQueryBindings[] = [new Date().toISOString()];
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
    values.push(id as string);
    _db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
    const row = _db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(id as string);
    return { task: deserializeTask(row) };
  });

  tools.set("complete_task", async (_db, input) => {
    const now = new Date().toISOString();
    _db.run(
      `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?`,
      [now, input.id as string]
    );
    const row = _db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(input.id as string);
    return { task: deserializeTask(row) };
  });

  // ── Entity tools ─────────────────────────────────────────────────────
  tools.set("list_entities", async (_db, input) => {
    let sql = "SELECT * FROM entities";
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (input.type) {
      conditions.push("type = ?");
      params.push(input.type as string);
    }
    if (input.tags) {
      conditions.push("tags LIKE ?");
      params.push(`%"${input.tags}"%`);
    }
    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC";

    const rows = _db.query(sql).all(...params) as Record<string, unknown>[];
    return { entities: rows.map(deserializeEntity) };
  });

  tools.set("create_entity", async (_db, input) => {
    const id = generateId();
    const now = new Date().toISOString();
    _db.run(
      `INSERT INTO entities (id, type, name, properties, tags, parent_id, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        (input.type as string) || "generic",
        (input.name as string) || "Unnamed",
        JSON.stringify(input.properties ?? {}),
        JSON.stringify(input.tags ?? []),
        (input.parent_id as string) ?? null,
        (input.source_id as string) ?? null,
        now,
        now,
      ]
    );
    const row = _db.query("SELECT * FROM entities WHERE id = ?").get(id);
    return { entity: deserializeEntity(row) };
  });

  tools.set("search_entities", async (_db, input) => {
    const query = input.query as string;
    if (!query) return { entities: [] };
    const rows = _db
      .query(
        `SELECT e.* FROM entities e JOIN entities_fts f ON e.id = f.rowid WHERE f.entities_fts MATCH ? ORDER BY rank`
      )
      .all(query) as Record<string, unknown>[];
    return { entities: rows.map(deserializeEntity) };
  });

  // ── File tools ───────────────────────────────────────────────────────
  tools.set("list_files", async (_db, input) => {
    let sql = "SELECT * FROM files";
    if (input.mime_type) {
      sql += " WHERE mime_type = ?";
      const rows = _db
        .query(sql)
        .all(input.mime_type as string) as Record<string, unknown>[];
      return { files: rows };
    }
    const rows = _db
      .query(sql + " ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return { files: rows };
  });

  // ── System tools ─────────────────────────────────────────────────────
  tools.set("system_status", async (_db) => {
    const taskCount = (
      _db.query("SELECT COUNT(*) as c FROM tasks").get() as any
    ).c;
    const entityCount = (
      _db.query("SELECT COUNT(*) as c FROM entities").get() as any
    ).c;
    return {
      status: "running",
      uptime: process.uptime(),
      version: "0.1.0",
      tasks: taskCount,
      entities: entityCount,
    };
  });

  // ── read_file — read a local file's text content ─────────────────────
  tools.set("read_file", async (_db, input) => {
    const filePath = input.path as string;
    if (!filePath) throw new Error("read_file: 'path' is required");
    validateFilePath(filePath);
    if (!existsSync(filePath)) throw new Error(`read_file: file not found: ${filePath}`);

    const content = readFileSync(filePath, "utf-8");

    // Optional: extract a section by start/end markers or line range
    if (input.start_line || input.end_line) {
      const lines = content.split("\n");
      const start = ((input.start_line as number) || 1) - 1;
      const end = (input.end_line as number) || lines.length;
      return { content: lines.slice(start, end).join("\n"), total_lines: lines.length };
    }

    // Optional: limit by max chars to avoid blowing up LLM context
    const maxChars = input.max_chars as number | undefined;
    if (maxChars && content.length > maxChars) {
      return {
        content: content.slice(0, maxChars),
        truncated: true,
        total_length: content.length,
      };
    }

    return { content, length: content.length };
  });

  // ── llm_generate — call Claude via Agent SDK (uses Max subscription) ─
  tools.set("llm_generate", async (_db, input) => {
    const prompt = input.prompt as string;
    if (!prompt) throw new Error("llm_generate: 'prompt' is required");

    const { llmCall } = await import("../llm/client.ts");

    const model = (input.model as "auto" | "haiku" | "sonnet" | "opus") || "auto";
    const systemPrompt = input.system as string | undefined;

    const text = await llmCall({ prompt, system: systemPrompt, model });

    return { text, model };
  });

  // ── write_file — write content to a file ─────────────────────────────
  tools.set("write_file", async (_db, input) => {
    const filePath = input.path as string;
    if (!filePath) throw new Error("write_file: 'path' is required");
    validateFilePath(filePath);
    const content = input.content as string;
    if (content === undefined) throw new Error("write_file: 'content' is required");

    const { mkdirSync, writeFileSync } = await import("fs");
    const { dirname } = await import("path");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf-8");
    log.info({ path: filePath, length: content.length }, "File written");
    return { path: filePath, length: content.length };
  });

  // ── shell_command — run a shell command ─────────────────────────────
  tools.set("shell_command", async (_db, input) => {
    const command = input.command as string;
    if (!command) throw new Error("shell_command: 'command' is required");
    validateShellCommand(command);
    const cwd = (input.cwd as string) || undefined;

    log.info({ command, cwd }, "Running shell command");
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      log.warn({ command, exitCode, stderr: stderr.slice(0, 500) }, "Shell command failed");
    }

    return { stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 5000), exit_code: exitCode };
  });

  // ── web_fetch — fetch a URL and return its text content ──────────────
  tools.set("web_fetch", async (_db, input) => {
    const url = input.url as string;
    if (!url) throw new Error("web_fetch: 'url' is required");
    await validateUrlNotSSRF(url);

    log.info({ url }, "Fetching URL");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`web_fetch: HTTP ${res.status} for ${url}`);

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    const maxChars = input.max_chars as number | undefined;
    if (maxChars && text.length > maxChars) {
      return {
        content: text.slice(0, maxChars),
        truncated: true,
        total_length: text.length,
        content_type: contentType,
      };
    }

    return { content: text, length: text.length, content_type: contentType };
  });

  return tools;
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

export class WorkflowExecutor {
  private approvalManager: ApprovalManager;
  private mcpPool: McpClientPool;
  private internalTools: Map<string, ToolHandler>;
  private dispatcher: NotificationDispatcher | null = null;

  constructor(
    private db: Database,
    private queue: JobQueue,
    masterKey: string
  ) {
    this.approvalManager = new ApprovalManager(db, masterKey);
    this.mcpPool = new McpClientPool(db);
    this.internalTools = buildInternalTools(db);
  }

  setDispatcher(dispatcher: NotificationDispatcher): void {
    this.dispatcher = dispatcher;
  }

  private async executeTool(
    step: WorkflowStep,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const server = step.server || "humanoms";

    // Internal tools — execute directly against the database
    if (server === "humanoms") {
      const handler = this.internalTools.get(step.tool);
      if (!handler) {
        log.warn(
          { tool: step.tool },
          "Unknown internal tool, returning empty result"
        );
        return {};
      }
      return handler(this.db, input || {});
    }

    // External MCP servers — call via client pool
    const result = await this.mcpPool.callTool(server, step.tool, input);
    // MCP tool results come as { content: [{ type, text }] }
    const mcpResult = result as {
      content?: Array<{ type: string; text: string }>;
    };
    if (mcpResult.content?.[0]?.text) {
      try {
        return JSON.parse(mcpResult.content[0].text);
      } catch {
        return { result: mcpResult.content[0].text };
      }
    }
    return { result };
  }

  async executeJob(job: Job): Promise<void> {
    // 1. Load the workflow from DB
    const workflowRow = this.db
      .query(`SELECT * FROM workflows WHERE id = ?`)
      .get(job.workflow_id) as WorkflowRow | null;

    if (!workflowRow) {
      this.queue.updateStatus(job.id, "failed", {
        error: `Workflow not found: ${job.workflow_id}`,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const steps = JSON.parse(workflowRow.steps) as WorkflowStep[];

    // 2. Create PipelineContext from job.input + job.context
    //    Inject built-in variables (date, datetime, timestamp)
    const now = new Date();
    const builtins = {
      date: now.toISOString().slice(0, 10),
      datetime: now.toISOString(),
      timestamp: String(now.getTime()),
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1).padStart(2, "0"),
      day: String(now.getDate()).padStart(2, "0"),
    };
    const ctx = new PipelineContext({ ...builtins, ...job.input, ...job.context });

    // 3. For each step starting at job.current_step
    for (let i = job.current_step; i < steps.length; i++) {
      const step = steps[i]!;

      try {
        // a. Interpolate {{variables}} in step input using template engine
        const interpolatedInput = (step.input
          ? interpolateObject(step.input, ctx.toJSON())
          : {}) as Record<string, unknown>;

        // b. Check trust_level — if "approve", create approval and pause
        //    Skip if this step was already approved (job resumed after approval).
        if (step.trust_level === "approve") {
          const alreadyApproved = this.db
            .query(
              `SELECT id FROM approvals WHERE job_id = ? AND step_index = ? AND status = 'approved' LIMIT 1`
            )
            .get(job.id, i);

          if (!alreadyApproved) {
            const token = this.approvalManager.createApproval(
              job.id,
              i,
              ctx.toJSON()
            );
            this.queue.updateStatus(job.id, "awaiting_approval", {
              current_step: i,
              context: ctx.toJSON(),
            });
            log.info(
              { jobId: job.id, step: i, tool: step.tool },
              "Job paused for approval"
            );

            // Send Discord notification for approval
            if (this.dispatcher) {
              this.dispatcher.sendApproval({
                title: `Approval needed: ${step.name || step.tool}`,
                message: `Job ${job.id} is waiting for approval at step ${i + 1} (${step.tool}).`,
                level: "warning",
                jobId: job.id,
                stepIndex: i,
                approveToken: token,
                rejectToken: token,
                metadata: { tool: step.tool, input: interpolatedInput },
              }).catch((err) => {
                log.error({ err }, "Failed to send approval notification");
              });
            }

            return;
          }

          log.info({ jobId: job.id, step: i }, "Step already approved, executing");
        }

        // c. Execute the tool for real
        log.info(
          {
            jobId: job.id,
            step: i,
            tool: step.tool,
            server: step.server || "humanoms",
            input: interpolatedInput,
          },
          "Executing step"
        );

        const output = await this.executeTool(step, interpolatedInput);

        log.info(
          {
            jobId: job.id,
            step: i,
            tool: step.tool,
            outputKeys: Object.keys(output),
          },
          "Step completed"
        );

        // d. Apply output_mapping to context
        if (step.output_mapping) {
          ctx.applyOutputMapping(step.output_mapping, output);
        }

        // Store step output in context under step name or index
        const stepKey = step.name || `step_${i}`;
        ctx.set(stepKey, output);

        // e. Update job's current_step and context in DB
        this.queue.updateStatus(job.id, "running", {
          current_step: i + 1,
          context: ctx.toJSON(),
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);

        log.error(
          { jobId: job.id, step: i, tool: step.tool, err: errorMessage },
          "Step failed"
        );

        // Handle based on on_failure policy
        const policy = step.on_failure ?? "abort";

        if (policy === "skip") {
          log.warn(
            { jobId: job.id, step: i, err },
            "Step failed, skipping"
          );
          this.queue.updateStatus(job.id, "running", {
            current_step: i + 1,
            context: ctx.toJSON(),
          });
          continue;
        }

        if (policy === "retry") {
          if (job.retries < job.max_retries) {
            log.warn(
              { jobId: job.id, step: i, retries: job.retries + 1 },
              "Step failed, retrying"
            );
            this.queue.updateStatus(job.id, "queued", {
              current_step: i,
              context: ctx.toJSON(),
              retries: job.retries + 1,
            });
            return;
          }
          // Exhausted retries — fall through to abort
          log.error(
            { jobId: job.id, step: i },
            "Retries exhausted, aborting"
          );
        }

        // policy === "abort" or retries exhausted
        this.queue.updateStatus(job.id, "failed", {
          current_step: i,
          context: ctx.toJSON(),
          error: errorMessage,
          completed_at: new Date().toISOString(),
        });
        return;
      }
    }

    // 4. On completion, set job status to "completed" with output
    this.queue.updateStatus(job.id, "completed", {
      output: ctx.toJSON(),
      completed_at: new Date().toISOString(),
    });

    log.info({ jobId: job.id }, "Job completed");
  }

  async shutdown(): Promise<void> {
    await this.mcpPool.disconnectAll();
  }
}
