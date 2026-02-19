/**
 * Resolve a dot-notation path against a nested object.
 * Supports keys like "file.name" and array indices like "notes.0.title".
 */
function resolvePath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
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
 * Replace all `{{key}}` placeholders in a template string with values from
 * the provided context. Supports dot notation (`{{file.name}}`) and array
 * access (`{{notes.0.title}}`).
 *
 * Unresolved placeholders are left as-is.
 */
export function interpolate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined || value === null) {
      return _match; // leave unresolved placeholders intact
    }
    return String(value);
  });
}

/**
 * Recursively walk an object/array and interpolate every string value found.
 * Non-string leaves are returned unchanged.
 */
export function interpolateObject(
  obj: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof obj === "string") {
    return interpolate(obj, context);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, context));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = interpolateObject(value, context);
    }
    return result;
  }

  // numbers, booleans, null, undefined — pass through
  return obj;
}
