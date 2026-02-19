import { describe, test, expect } from "bun:test";
import { routeSearch } from "../../src/lib/search-router.ts";

describe("routeSearch", () => {
  test("routes routine queries to brave", () => {
    expect(routeSearch({ query: "weather today" })).toBe("brave");
    expect(routeSearch({ query: "what is TypeScript" })).toBe("brave");
  });

  test("routes research queries to exa", () => {
    expect(
      routeSearch({ query: "research papers on quantum computing" })
    ).toBe("exa");
  });

  test("routes 'similar to' queries to exa", () => {
    expect(routeSearch({ query: "similar to this article" })).toBe("exa");
  });

  test("routes 'in-depth' queries to exa", () => {
    expect(routeSearch({ query: "in-depth analysis of market trends" })).toBe(
      "exa"
    );
  });

  test("routes 'find academic papers' to exa", () => {
    expect(routeSearch({ query: "find academic papers" })).toBe("exa");
  });

  test("respects forced provider parameter", () => {
    expect(routeSearch({ query: "weather today", provider: "exa" })).toBe(
      "exa"
    );
    expect(
      routeSearch({ query: "research papers on AI", provider: "brave" })
    ).toBe("brave");
  });
});
