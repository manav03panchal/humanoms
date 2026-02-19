import { describe, test, expect } from "bun:test";
import { PipelineContext } from "../../src/jobs/context.ts";

describe("PipelineContext", () => {
  test("get/set basic values", () => {
    const ctx = new PipelineContext();
    ctx.set("name", "Alice");
    ctx.set("count", 42);
    expect(ctx.get("name")).toBe("Alice");
    expect(ctx.get("count")).toBe(42);
  });

  test("initializes from constructor argument", () => {
    const ctx = new PipelineContext({ existing: "value" });
    expect(ctx.get("existing")).toBe("value");
  });

  test("get returns undefined for missing key", () => {
    const ctx = new PipelineContext();
    expect(ctx.get("missing")).toBeUndefined();
  });

  test("set overwrites existing values", () => {
    const ctx = new PipelineContext({ key: "old" });
    ctx.set("key", "new");
    expect(ctx.get("key")).toBe("new");
  });

  test("applyOutputMapping extracts nested paths", () => {
    const ctx = new PipelineContext();
    const output = {
      result: {
        text: "Hello world",
        metadata: { count: 5 },
      },
    };

    ctx.applyOutputMapping(
      {
        parsed_text: "result.text",
        item_count: "result.metadata.count",
      },
      output
    );

    expect(ctx.get("parsed_text")).toBe("Hello world");
    expect(ctx.get("item_count")).toBe(5);
  });

  test("applyOutputMapping handles missing paths gracefully", () => {
    const ctx = new PipelineContext();
    const output = { result: { text: "hi" } };

    ctx.applyOutputMapping(
      { value: "result.nonexistent.deep" },
      output
    );

    // Missing path should not set the key
    expect(ctx.get("value")).toBeUndefined();
  });

  test("applyOutputMapping works with array indices", () => {
    const ctx = new PipelineContext();
    const output = { items: ["alpha", "beta", "gamma"] };

    ctx.applyOutputMapping({ first: "items.0", second: "items.1" }, output);

    expect(ctx.get("first")).toBe("alpha");
    expect(ctx.get("second")).toBe("beta");
  });

  test("toJSON returns all context data", () => {
    const ctx = new PipelineContext({ a: 1 });
    ctx.set("b", "two");
    ctx.set("c", [1, 2, 3]);

    const json = ctx.toJSON();
    expect(json).toEqual({ a: 1, b: "two", c: [1, 2, 3] });
  });

  test("toJSON returns a copy, not a reference", () => {
    const ctx = new PipelineContext({ key: "value" });
    const json = ctx.toJSON();
    json.key = "modified";

    // Original context should be unchanged
    expect(ctx.get("key")).toBe("value");
  });
});
