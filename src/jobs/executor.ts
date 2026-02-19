import type { Database } from "bun:sqlite";
import { createChildLogger } from "../lib/logger.ts";
import { interpolateObject } from "../lib/template.ts";
import { JobQueue } from "./queue.ts";
import type { Job } from "./queue.ts";
import { PipelineContext } from "./context.ts";
import { ApprovalManager } from "./approval.ts";

const log = createChildLogger("executor");

interface WorkflowStep {
  tool: string;
  input: Record<string, unknown>;
  trust_level?: "auto" | "approve";
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

export class WorkflowExecutor {
  private approvalManager: ApprovalManager;

  constructor(
    private db: Database,
    private queue: JobQueue,
    approvalSecret: string = "default-approval-secret"
  ) {
    this.approvalManager = new ApprovalManager(db, approvalSecret);
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
    const ctx = new PipelineContext({ ...job.input, ...job.context });

    // 3. For each step starting at job.current_step
    for (let i = job.current_step; i < steps.length; i++) {
      const step = steps[i]!;

      try {
        // a. Interpolate {{variables}} in step input using template engine
        const interpolatedInput = interpolateObject(
          step.input,
          ctx.toJSON()
        ) as Record<string, unknown>;

        // b. Check trust_level — if "approve", create approval and pause
        if (step.trust_level === "approve") {
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
            { jobId: job.id, step: i, tool: step.tool, token },
            "Job paused for approval"
          );
          return;
        }

        // c. Execute the tool (stub: log and return empty output)
        log.info(
          { jobId: job.id, step: i, tool: step.tool, input: interpolatedInput },
          "Executing step (stub)"
        );
        const output: Record<string, unknown> = {};

        // d. Apply output_mapping to context
        if (step.output_mapping) {
          ctx.applyOutputMapping(step.output_mapping, output);
        }

        // e. Update job's current_step and context in DB
        this.queue.updateStatus(job.id, "running", {
          current_step: i + 1,
          context: ctx.toJSON(),
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);

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
}
