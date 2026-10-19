export const PROVIDERS = ["exa", "tavily", "brave", "serper", "serpapi", "you", "perplexity", "openai", "parallel", "firecrawl", "jina", "linkup", "happenstance"] as const;
export type ProviderId = typeof PROVIDERS[number];
export type ProviderKeys = Partial<Record<ProviderId, string>>;
export type SearchMode = "auto" | "single" | "parallel" | "fallback";

export interface SearchRequest {
  query: string;
  mode?: SearchMode;
  providers?: ProviderId[];
  excludeProviders?: ProviderId[];
  limit?: number;
  maxProviders?: number;
  content?: "none" | "text";
  maxContentChars?: number;
  /** Enrich sources missing full text using an enabled extraction provider. */
  fetchMissingContent?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeoutMs?: number;
  providerOptions?: Partial<Record<ProviderId, Record<string, unknown>>>;
  /** Server-side use only. Never expose provider keys in a browser. */
  providerKeys?: ProviderKeys;
}

export interface ContentsRequest {
  urls: string[];
  provider?: ProviderId;
  maxContentChars?: number;
  timeoutMs?: number;
  providerKeys?: ProviderKeys;
}

export interface SourceContent {
  text: string;
  format: "text" | "markdown";
  provider: ProviderId;
  truncated: boolean;
}
export interface Source {
  id: string;
  url: string;
  title: string;
  snippet: string;
  content?: SourceContent;
  publishedAt?: string;
  providers: ProviderId[];
  rank: number;
}
export interface ProviderError {
  provider: ProviderId | "jev" | "openai-decisions";
  operation: "search" | "contents" | "routing";
  code: string;
  retryable: boolean;
}
export interface Attempt {
  provider: ProviderId;
  operation: "search" | "contents";
  status: "ok" | "error";
  elapsedMs: number;
}
export interface RoutingDecision {
  router: "jev" | "openai-decisions" | "rules" | "custom" | "explicit";
  providers: ProviderId[];
  reason: string;
  confidence?: number;
}
export interface SearchResponse {
  id: string;
  query: string;
  sources: Source[];
  answers: {provider: ProviderId; text: string}[];
  routing: RoutingDecision;
  attempts: Attempt[];
  errors: ProviderError[];
  warnings: string[];
  elapsedMs: number;
}
export interface ContentsResponse {
  id: string;
  sources: Source[];
  errors: ProviderError[];
  warnings: string[];
  elapsedMs: number;
}
export interface ProviderInfo {
  id: ProviderId;
  description: string;
  contents: boolean;
  configured: boolean;
  enabled: boolean;
}
export interface SearchService {
  search(request: SearchRequest, options?: {signal?: AbortSignal}): Promise<SearchResponse>;
  contents(request: ContentsRequest, options?: {signal?: AbortSignal}): Promise<ContentsResponse>;
}

export const PRESETS = {
  fast: {mode: "single", limit: 5, content: "none", maxProviders: 1, timeoutMs: 10_000},
  balanced: {mode: "auto", limit: 10, content: "none", maxProviders: 2, timeoutMs: 20_000},
  research: {mode: "auto", limit: 15, content: "text", fetchMissingContent: true, maxProviders: 3, maxContentChars: 20_000, timeoutMs: 45_000},
} as const satisfies Record<string, Partial<SearchRequest>>;
