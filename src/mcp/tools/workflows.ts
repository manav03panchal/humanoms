import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "bun:sqlite";
import { generateId } from "../../lib/ulid.ts";

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

export function registerWorkflowTools(server: McpServer, db: Database): void {
  // create_workflow
  server.tool(
    "create_workflow",
    "Create a new workflow",
    {
      name: z.string().min(1),
      description: z.string().optional(),
      steps: z.array(z.record(z.string(), z.unknown())).min(1),
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

      const created = db
        .query("SELECT * FROM workflows WHERE id = ?")
        .get(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeWorkflow(created)),
          },
        ],
      };
    }
  );

  // list_workflows
  server.tool(
    "list_workflows",
    "List all workflows",
    {},
    async () => {
      const rows = db
        .query("SELECT * FROM workflows ORDER BY created_at DESC")
        .all();
      const workflows = (rows as Record<string, unknown>[]).map(
        deserializeWorkflow
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(workflows) },
        ],
      };
    }
  );

  // trigger_workflow
  server.tool(
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
      if (!workflow) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Workflow not found" }),
            },
          ],
          isError: true,
        };
      }

      const jobId = generateId();
      const now = new Date().toISOString();
      const input = params.input ?? {};

      db.run(
        `INSERT INTO jobs (id, workflow_id, status, current_step, input, context, retries, max_retries, created_at)
         VALUES (?, ?, 'queued', 0, ?, '{}', 0, 3, ?)`,
        [jobId, params.workflow_id, JSON.stringify(input), now]
      );

      const job = db.query("SELECT * FROM jobs WHERE id = ?").get(jobId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeJob(job)),
          },
        ],
      };
    }
  );

  // get_job_status
  server.tool(
    "get_job_status",
    "Get the status of a job",
    {
      job_id: z.string().min(1),
    },
    async (params) => {
      const row = db
        .query("SELECT * FROM jobs WHERE id = ?")
        .get(params.job_id);
      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Job not found" }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(deserializeJob(row)),
          },
        ],
      };
    }
  );
}
