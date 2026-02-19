import { z } from "zod";

// --- Task Schemas ---

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  status: TaskStatusSchema.default("pending"),
  priority: z.number().int().min(0).max(4).default(0),
  due_date: z.string().datetime().optional(),
  recurrence: z.string().max(100).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

// --- Entity Schemas ---

export const CreateEntitySchema = z.object({
  type: z.string().min(1).max(100),
  name: z.string().min(1).max(500),
  properties: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  parent_id: z.string().optional(),
  source_id: z.string().optional(),
});

export const UpdateEntitySchema = CreateEntitySchema.partial();

// --- File Schemas ---

export const RegisterFileSchema = z.object({
  name: z.string(),
  path: z.string(),
  mime_type: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// --- Workflow Schemas ---

export const TrustLevelSchema = z.enum(["auto", "notify", "approve"]);

export const WorkflowStepSchema = z.object({
  name: z.string(),
  tool: z.string(),
  server: z.string(),
  input: z.record(z.string(), z.unknown()),
  trust_level: TrustLevelSchema,
  timeout_ms: z.number().int().positive().default(60000),
  retry: z
    .object({
      max: z.number().int().positive(),
      delay_ms: z.number().int().positive(),
    })
    .optional(),
  on_failure: z.enum(["abort", "skip", "retry"]).default("abort"),
  output_mapping: z.record(z.string(), z.string()).optional(),
});

export const CreateWorkflowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(50),
});

export const TriggerWorkflowSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
});

// --- Automation Schemas ---

export const CreateAutomationSchema = z.object({
  name: z.string(),
  description: z.string(),
  cron_expression: z.string(),
  workflow_id: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const UpdateAutomationSchema = CreateAutomationSchema.partial();

// --- Pagination Schema ---

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// --- API Response Type Helpers ---

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
