/**
 * Resolve a dot-notation path against a nested object/value.
 */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Pipeline context that accumulates variables across workflow steps.
 * Each step can read from and write to this shared context, enabling
 * data to flow between steps in a workflow.
 */
export class PipelineContext {
  private data: Record<string, unknown> = {};

  constructor(initial: Record<string, unknown> = {}) {
    this.data = { ...initial };
  }

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }

  /**
   * Apply an output mapping from a step's result to context variables.
   * For each entry in mapping like `{ "parsed_text": "result.text" }`,
   * extract the value from output using dot notation and store in context.
   */
  applyOutputMapping(
    mapping: Record<string, string>,
    output: unknown
  ): void {
    for (const [contextKey, outputPath] of Object.entries(mapping)) {
      const value = resolvePath(output, outputPath);
      if (value !== undefined) {
        this.data[contextKey] = value;
      }
    }
  }

  toJSON(): Record<string, unknown> {
    return { ...this.data };
  }
}
