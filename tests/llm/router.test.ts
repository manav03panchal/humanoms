import { describe, test, expect } from "bun:test";
import { routeModel } from "../../src/llm/router.ts";

describe("routeModel", () => {
  test("routes short simple prompts to haiku", () => {
    expect(routeModel("What is 2 + 2?")).toBe("haiku");
  });

  test("routes formatting tasks to haiku", () => {
    expect(routeModel("Format this JSON data nicely")).toBe("haiku");
  });

  test("routes classification tasks to haiku", () => {
    expect(routeModel("Classify this email as spam or not spam")).toBe("haiku");
  });

  test("routes extraction tasks to haiku", () => {
    expect(routeModel("Extract the email address from this text")).toBe(
      "haiku"
    );
  });

  test("routes yes/no questions to haiku", () => {
    expect(routeModel("Is this a valid URL? yes or no")).toBe("haiku");
  });

  test("routes true/false questions to haiku", () => {
    expect(routeModel("Is 42 even? true or false")).toBe("haiku");
  });

  test("routes list tasks to haiku", () => {
    expect(routeModel("List the top 5 items as bullet points")).toBe("haiku");
  });

  test("routes medium-length prompts to sonnet", () => {
    // Generate a prompt between 500 and 5000 estimated tokens (2000-20000 chars)
    const mediumPrompt =
      "Summarize the following article: " + "word ".repeat(600);
    expect(routeModel(mediumPrompt)).toBe("sonnet");
  });

  test("routes blog writing to opus", () => {
    expect(routeModel("Write a blog post about machine learning")).toBe("opus");
  });

  test("routes comprehensive analysis to opus", () => {
    expect(
      routeModel("Provide a comprehensive analysis of the quarterly results")
    ).toBe("opus");
  });

  test("routes in-depth requests to opus", () => {
    expect(routeModel("Give me an in-depth review of this codebase")).toBe(
      "opus"
    );
  });

  test("routes multi-source synthesis to opus", () => {
    expect(
      routeModel(
        "Based on multiple sources, compile a report on climate change"
      )
    ).toBe("opus");
  });

  test("routes very long prompts to opus via token estimation", () => {
    const longPrompt = "Analyze this: " + "text ".repeat(6000);
    expect(routeModel(longPrompt)).toBe("opus");
  });
});
