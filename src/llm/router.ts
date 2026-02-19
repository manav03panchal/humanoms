export type ModelTier = "haiku" | "sonnet" | "opus";

const OPUS_SIGNALS = [
  /write\s+(a\s+)?blog/i,
  /comprehensive\s+analysis/i,
  /in-depth|thorough|nuanced/i,
  /based on.*(multiple|several|\d+)\s+(sources|papers|documents)/i,
];

const HAIKU_SIGNALS = [
  /classify|categorize|tag/i,
  /format\s+(this|the)/i,
  /extract\s+(the\s+)?(name|date|email|number)/i,
  /yes\s+or\s+no/i,
  /true\s+or\s+false/i,
  /list\s+(as|the)/i,
];

export function routeModel(prompt: string): ModelTier {
  if (OPUS_SIGNALS.some((r) => r.test(prompt))) return "opus";
  if (HAIKU_SIGNALS.some((r) => r.test(prompt))) return "haiku";

  const estimatedTokens = Math.ceil(prompt.length / 4);
  if (estimatedTokens < 500) return "haiku";
  if (estimatedTokens < 5000) return "sonnet";
  return "opus";
}
