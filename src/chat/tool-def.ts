import { z } from "zod";

// ── Types ────────────────────────────────────────────────────────────────

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  handler: (params: any) => Promise<ToolResult>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function json(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function jsonError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ── Tool factory ─────────────────────────────────────────────────────────

export function defineTool<T extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: T,
  handler: (params: z.infer<z.ZodObject<T>>) => Promise<ToolResult>
): ToolDefinition {
  return {
    name,
    description,
    schema: z.object(shape),
    handler: handler as (params: any) => Promise<ToolResult>,
  };
}

// ── Zod → JSON Schema ───────────────────────────────────────────────────

function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean } {
  if (schema instanceof z.ZodOptional) {
    return { inner: (schema as any)._def.innerType, optional: true };
  }
  if (schema instanceof z.ZodDefault) {
    const child = (schema as any)._def.innerType;
    if (child instanceof z.ZodOptional) {
      return { inner: (child as any)._def.innerType, optional: true };
    }
    return { inner: child, optional: true };
  }
  return { inner: schema, optional: false };
}

function convertType(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodString) {
    const s: Record<string, unknown> = { type: "string" };
    for (const c of (schema as any)._def.checks || []) {
      if (c.kind === "min") s.minLength = c.value;
      if (c.kind === "max") s.maxLength = c.value;
      if (c.kind === "url") s.format = "uri";
    }
    return s;
  }

  if (schema instanceof z.ZodNumber) {
    const checks = (schema as any)._def.checks || [];
    const isInt = checks.some((c: any) => c.kind === "int");
    const s: Record<string, unknown> = { type: isInt ? "integer" : "number" };
    for (const c of checks) {
      if (c.kind === "min") s.minimum = c.value;
      if (c.kind === "max") s.maximum = c.value;
    }
    return s;
  }

  if (schema instanceof z.ZodBoolean) return { type: "boolean" };

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: (schema as any)._def.values };
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: convertType((schema as any)._def.type) };
  }

  if (schema instanceof z.ZodObject) {
    return objectToSchema(schema as z.ZodObject<any>);
  }

  if (schema instanceof z.ZodRecord) return { type: "object" };
  if (schema instanceof z.ZodOptional) return convertType((schema as any)._def.innerType);
  if (schema instanceof z.ZodDefault) return convertType((schema as any)._def.innerType);

  return {};
}

function objectToSchema(schema: z.ZodObject<any>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, val] of Object.entries(shape)) {
    const { inner, optional } = unwrap(val as z.ZodTypeAny);
    properties[key] = convertType(inner);
    if (!optional) required.push(key);
  }

  const result: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

export function zodToJsonSchema(schema: z.ZodObject<any>): Record<string, unknown> {
  return objectToSchema(schema);
}
