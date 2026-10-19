import {setTimeout as delay} from "node:timers/promises";
import {upstream, UpstreamError, type Fetch} from "./http.js";
import {record} from "./validation.js";
import {PROVIDERS, type ProviderId, type ProviderKeys, type SearchRequest} from "./types.js";

export interface RawSource { url: unknown; title?: unknown; snippet?: unknown; text?: unknown; format?: "text" | "markdown"; publishedAt?: unknown }
export interface ProviderResult { sources: RawSource[]; answer?: string }
export interface ProviderContext { key: string; fetch: Fetch; signal: AbortSignal }
export interface SearchProvider {
  id: ProviderId;
  description: string;
  search(request: SearchRequest, context: ProviderContext): Promise<ProviderResult>;
  contents?(urls: string[], maxChars: number, context: ProviderContext): Promise<ProviderResult>;
}
export const KEY_ENV: Record<ProviderId, string> = {
  exa: "EXA_API_KEY", tavily: "TAVILY_API_KEY", brave: "BRAVE_API_KEY", serper: "SERPER_API_KEY", serpapi: "SERPAPI_API_KEY", you: "YOU_API_KEY", perplexity: "PERPLEXITY_API_KEY", openai: "OPENAI_API_KEY", parallel: "PARALLEL_API_KEY", firecrawl: "FIRECRAWL_API_KEY", jina: "JINA_API_KEY", linkup: "LINKUP_API_KEY", happenstance: "HAPPENSTANCE_API_KEY",
};
export function keysFromEnv(env: Record<string, string | undefined> = process.env): ProviderKeys {
  return Object.fromEntries(PROVIDERS.flatMap(id => env[KEY_ENV[id]]?.trim() ? [[id, env[KEY_ENV[id]]!.trim()]] : []));
}
function list(value: unknown): Record<string, any>[] {
  if (!Array.isArray(value)) throw new UpstreamError("provider", "invalid_response", 502, false);
  return value.map(record);
}
const strings = (v: unknown) => Array.isArray(v) ? v.filter(x => typeof x === "string").join("\n") : undefined;
const options = (r: SearchRequest, id: ProviderId) => r.providerOptions?.[id] ?? {};
const textWanted = (r: SearchRequest) => r.content === "text";
const limit = (r: SearchRequest, cap = 20) => Math.min(r.limit ?? 10, cap);
function call(c: ProviderContext, id: string, url: string, body?: unknown, header?: string | null, method = "POST") { return upstream(c.fetch, id, url, c.key, body, c.signal, header, method); }
function queryUrl(base: string, params: Record<string, unknown>) {
  const url = new URL(base);
  for (const [key, val] of Object.entries(params)) if (val !== undefined && val !== null) url.searchParams.set(key, String(val));
  return url.href;
}

const exaSources = (d: any): ProviderResult => ({sources: list(d.results).map(x => ({url: x.url, title: x.title, snippet: strings(x.highlights) ?? x.summary, text: x.text, publishedAt: x.publishedDate, format: "text"}))});
const exa: SearchProvider = {
  id: "exa", description: "Semantic web search, technical sources, papers and page text",
  async search(r, c) { return exaSources(await call(c, "exa", "https://api.exa.ai/search", {...options(r, "exa"), query: r.query, type: options(r, "exa").type ?? "auto", numResults: limit(r, 50), includeDomains: r.includeDomains, excludeDomains: r.excludeDomains, contents: textWanted(r) ? {text: {maxCharacters: r.maxContentChars ?? 12_000}, highlights: true} : {highlights: true}}, "x-api-key")); },
  async contents(urls, maxChars, c) { return exaSources(await call(c, "exa", "https://api.exa.ai/contents", {urls, text: {maxCharacters: maxChars}}, "x-api-key")); },
};
const tavily: SearchProvider = {
  id: "tavily", description: "General web grounding and agent-oriented snippets, with page extraction",
  async search(r, c) {
    const d = await call(c, "tavily", "https://api.tavily.com/search", {...options(r, "tavily"), query: r.query, max_results: limit(r), include_raw_content: textWanted(r) ? "markdown" : false, include_domains: r.includeDomains, exclude_domains: r.excludeDomains});
    return {sources: list(d.results).map(x => ({url: x.url, title: x.title, snippet: x.content, text: x.raw_content, format: "markdown", publishedAt: x.published_date})), answer: typeof d.answer === "string" ? d.answer : undefined};
  },
  async contents(urls, _maxChars, c) {
    const d = await call(c, "tavily", "https://api.tavily.com/extract", {urls, format: "markdown"});
    return {sources: list(d.results).map(x => ({url: x.url, text: x.raw_content, format: "markdown"}))};
  },
};
const brave: SearchProvider = {
  id: "brave", description: "Independent web index, fresh news and broad web discovery",
  async search(r, c) {
    const d = await call(c, "brave", queryUrl("https://api.search.brave.com/res/v1/web/search", {...options(r, "brave"), q: r.query, count: limit(r), extra_snippets: true}), undefined, "X-Subscription-Token", "GET");
    return {sources: list(d.web?.results ?? []).map(x => ({url: x.url, title: x.title, snippet: strings(x.extra_snippets) ?? x.description, publishedAt: x.page_age}))};
  },
};
const serper: SearchProvider = {
  id: "serper", description: "Google results and navigational web searches",
  async search(r, c) {
    const d = await call(c, "serper", "https://google.serper.dev/search", {...options(r, "serper"), q: r.query, num: limit(r, 50)}, "X-API-KEY");
    return {sources: list(d.organic ?? []).map(x => ({url: x.link, title: x.title, snippet: x.snippet, publishedAt: x.date}))};
  },
};
const serpapi: SearchProvider = {
  id: "serpapi", description: "Google search results with engine-specific localization options",
  async search(r, c) {
    const d = await call(c, "serpapi", queryUrl("https://serpapi.com/search.json", {...options(r, "serpapi"), engine: "google", q: r.query, num: limit(r, 50), api_key: c.key}), undefined, null, "GET");
    if (d.error) throw new UpstreamError("serpapi", "provider_error", 502, false);
    return {sources: list(d.organic_results ?? []).map(x => ({url: x.link, title: x.title, snippet: x.snippet, publishedAt: x.date}))};
  },
};
const you: SearchProvider = {
  id: "you", description: "Web and news search with optional full-page markdown",
  async search(r, c) {
    const d = await call(c, "you", "https://ydc-index.io/v1/search", {...options(r, "you"), query: r.query, count: limit(r), include_domains: r.includeDomains, exclude_domains: r.excludeDomains, ...(textWanted(r) ? {extraction: {extraction_mode: "full_page", full_page: {extraction_formats: ["markdown"]}}} : {})}, "X-API-Key");
    return {sources: list(d.results?.web ?? []).map(x => ({url: x.url, title: x.title, snippet: strings(x.snippets) ?? x.description, text: x.contents?.markdown, format: "markdown", publishedAt: x.page_age}))};
  },
};
const perplexity: SearchProvider = {
  id: "perplexity", description: "Ranked web search with recent sources and domain filters",
  async search(r, c) {
    const d = await call(c, "perplexity", "https://api.perplexity.ai/search", {...options(r, "perplexity"), query: r.query, max_results: limit(r), ...(r.includeDomains?.length ? {search_domain_filter: r.includeDomains.slice(0, 20)} : {})});
    return {sources: list(d.results).map(x => ({url: x.url, title: x.title, snippet: x.snippet, publishedAt: x.date}))};
  },
};
const parallel: SearchProvider = {
  id: "parallel", description: "Multi-source research and high-quality web excerpts; separate full-page extraction",
  async search(r, c) {
    const d = await call(c, "parallel", "https://api.parallel.ai/v1/search", {...options(r, "parallel"), objective: r.query, search_queries: [r.query], mode: options(r, "parallel").mode ?? "basic"}, "x-api-key");
    return {sources: list(d.results).map(x => ({url: x.url, title: x.title, snippet: strings(x.excerpts), publishedAt: x.publish_date}))};
  },
  async contents(urls, _maxChars, c) {
    const d = await call(c, "parallel", "https://api.parallel.ai/v1/extract", {urls, advanced_settings: {full_content: true}}, "x-api-key");
    return {sources: list(d.results).map(x => ({url: x.url, title: x.title, text: x.full_content, format: "markdown", publishedAt: x.publish_date}))};
  },
};
const firecrawl: SearchProvider = {
  id: "firecrawl", description: "Search and scrape websites for complete markdown content",
  async search(r, c) {
    const d = await call(c, "firecrawl", "https://api.firecrawl.dev/v2/search", {...options(r, "firecrawl"), query: r.query, limit: limit(r, 50), ...(textWanted(r) ? {scrapeOptions: {formats: ["markdown"]}} : {})});
    if (d.success === false) throw new UpstreamError("firecrawl", "provider_error", 502, false);
    return {sources: list(d.data?.web ?? d.data ?? []).map(x => ({url: x.url, title: x.title, snippet: x.description, text: x.markdown, format: "markdown"}))};
  },
  async contents(urls, _maxChars, c) {
    // Sequential calls keep provider concurrency bounded. The shared signal bounds the whole operation.
    const sources: RawSource[] = [];
    for (const url of urls) {
      const d = await call(c, "firecrawl", "https://api.firecrawl.dev/v2/scrape", {url, formats: ["markdown"]});
      if (!d.success) throw new UpstreamError("firecrawl", "provider_error", 502, false);
      sources.push({url, title: d.data?.metadata?.title, text: d.data?.markdown, format: "markdown"});
    }
    return {sources};
  },
};
const jina: SearchProvider = {
  id: "jina", description: "Web search with reader content and markdown URL retrieval",
  async search(r, c) {
    const d = await call(c, "jina", queryUrl(`https://s.jina.ai/${encodeURIComponent(r.query)}`, options(r, "jina")), undefined, undefined, "GET");
    return {sources: list(d.data).map(x => ({url: x.url, title: x.title, snippet: x.description, text: x.content, format: "markdown"}))};
  },
  async contents(urls, _maxChars, c) {
    const sources: RawSource[] = [];
    for (const url of urls) {
      const d = await call(c, "jina", `https://r.jina.ai/${url}`, undefined, undefined, "GET");
      sources.push({url, title: d.data?.title, text: d.data?.content, format: "markdown"});
    }
    return {sources};
  },
};
const linkup: SearchProvider = {
  id: "linkup", description: "Company intelligence and web research with ranked source snippets",
  async search(r, c) {
    const d = await call(c, "linkup", "https://api.linkup.so/v1/search", {...options(r, "linkup"), q: r.query, depth: options(r, "linkup").depth ?? "standard", outputType: "searchResults", maxResults: limit(r, 50), includeDomains: r.includeDomains, excludeDomains: r.excludeDomains});
    return {sources: list(d.results).map(x => ({url: x.url, title: x.name, snippet: x.content}))};
  },
};
const openai: SearchProvider = {
  id: "openai", description: "Web-backed answers with cited sources; page text requires a separate extraction provider",
  async search(r, c) {
    const {model = "gpt-4.1-mini", ...extra} = options(r, "openai");
    const d = await call(c, "openai", "https://api.openai.com/v1/responses", {...extra, model, input: r.query, tools: [{type: "web_search", ...(r.includeDomains?.length ? {filters: {allowed_domains: r.includeDomains}} : {})}], tool_choice: "required", include: ["web_search_call.action.sources"], store: false});
    const sources: RawSource[] = []; const answer: string[] = [];
    for (const output of list(d.output)) {
      if (output.type === "web_search_call" && Array.isArray(output.action?.sources)) for (const s of output.action.sources) sources.push({url: s.url, title: s.title});
      if (output.type === "message") for (const part of list(output.content ?? [])) {
        if (part.type === "output_text" && typeof part.text === "string") answer.push(part.text);
        for (const a of list(part.annotations ?? [])) if (a.type === "url_citation") sources.push({url: a.url, title: a.title});
      }
    }
    return {sources, answer: answer.join("\n") || undefined};
  },
};
const happenstance: SearchProvider = {
  id: "happenstance", description: "Find people and warm connections in the configured professional network",
  async search(r, c) {
    const d = await call(c, "happenstance", "https://api.happenstance.ai/v1/search", {include_my_connections: true, ...options(r, "happenstance"), text: r.query});
    if (typeof d.id !== "string" || !d.id) throw new UpstreamError("happenstance", "invalid_response", 502, false);
    for (;;) {
      const result = await call(c, "happenstance", `https://api.happenstance.ai/v1/search/${encodeURIComponent(d.id)}`, undefined, undefined, "GET");
      if (result.status === "FAILED") throw new UpstreamError("happenstance", "search_failed", 502, true);
      if (result.status === "COMPLETED") return {sources: list(result.results ?? []).map(x => ({url: x.socials?.happenstance_url, title: x.name, snippet: [x.current_title, x.current_company].filter(v => typeof v === "string").join(" at ")}))};
      if (result.status !== "RUNNING") throw new UpstreamError("happenstance", "invalid_response", 502, false);
      try { await delay(500, undefined, {signal: c.signal}); } catch { throw new UpstreamError("happenstance", "timeout_or_cancelled", 502, true); }
    }
  },
};
export const builtinProviders: SearchProvider[] = [exa, tavily, brave, serper, serpapi, you, perplexity, openai, parallel, firecrawl, jina, linkup, happenstance];
