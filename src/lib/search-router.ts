export type SearchProvider = "brave" | "exa";

interface RouteSearchOptions {
  query: string;
  provider?: SearchProvider;
}

const EXA_SIGNALS = [
  /research|paper|study|academic/i,
  /similar\s+to|related\s+to|like\s+this/i,
  /in-depth|comprehensive|thorough|deep\s+dive/i,
  /find\s+(articles?|papers?|publications?)/i,
  /semantic|conceptual/i,
];

export function routeSearch(options: RouteSearchOptions): SearchProvider {
  if (options.provider) return options.provider;
  if (EXA_SIGNALS.some((r) => r.test(options.query))) return "exa";
  return "brave";
}
