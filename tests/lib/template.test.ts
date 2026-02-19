import { describe, test, expect } from "bun:test";
import { interpolate, interpolateObject } from "../../src/lib/template.ts";

describe("interpolate", () => {
  test("replaces simple variables", () => {
    expect(interpolate("Hello {{name}}", { name: "World" })).toBe(
      "Hello World"
    );
  });

  test("replaces dot-notation paths", () => {
    expect(
      interpolate("File: {{file.name}}", { file: { name: "doc.pdf" } })
    ).toBe("File: doc.pdf");
  });

  test("handles array index access", () => {
    expect(
      interpolate("First: {{items.0}}", { items: ["alpha", "beta"] })
    ).toBe("First: alpha");
  });

  test("leaves unresolved placeholders intact", () => {
    expect(interpolate("{{missing}}", {})).toBe("{{missing}}");
  });

  test("handles whitespace in placeholders", () => {
    expect(interpolate("{{ name }}", { name: "trimmed" })).toBe("trimmed");
  });

  test("converts numbers to strings", () => {
    expect(interpolate("Count: {{n}}", { n: 42 })).toBe("Count: 42");
  });
});

describe("interpolateObject", () => {
  test("recursively interpolates all strings", () => {
    const result = interpolateObject(
      { greeting: "Hello {{name}}", nested: { msg: "{{name}} here" } },
      { name: "Alice" }
    );
    expect(result).toEqual({
      greeting: "Hello Alice",
      nested: { msg: "Alice here" },
    });
  });

  test("passes through non-string values", () => {
    const result = interpolateObject({ count: 42, flag: true }, {});
    expect(result).toEqual({ count: 42, flag: true });
  });

  test("handles arrays", () => {
    const result = interpolateObject(
      ["{{a}}", "{{b}}"],
      { a: "x", b: "y" }
    );
    expect(result).toEqual(["x", "y"]);
  });
});
