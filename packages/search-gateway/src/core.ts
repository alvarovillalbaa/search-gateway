import {createHash, randomUUID} from "node:crypto";
import {builtinProviders, type ProviderResult, type RawSource, type SearchProvider} from "./providers.js";
import {route, type RouterOptions} from "./routing.js";
import {GatewayError, domainAllowed, publicUrl, validateSearch, validateContents} from "./validation.js";
import {UpstreamError, type Fetch} from "./http.js";
import {PROVIDERS, PRESETS, type ContentsRequest, type ContentsResponse, type ProviderError, type ProviderId, type ProviderInfo, type ProviderKeys, type SearchRequest, type SearchResponse, type Source, type Attempt} from "./types.js";

export interface GatewayOptions {
  providerKeys?: ProviderKeys;
  enabledProviders?: ProviderId[];
  defaults?: Partial<SearchRequest>;
  router?: RouterOptions;
  fetch?: Fetch;
  /** Trusted server extension point; built-in IDs may be replaced for private deployments. */
  adapters?: SearchProvider[];
}
function normalize(raw: RawSource, provider: ProviderId, rank: number, request: {content?: string; maxContentChars?: number}): Source | undefined {
  const url = publicUrl(raw.url); if (!url) return;
  const max = request.maxContentChars ?? 12_000;
  const text = typeof raw.text === "string" ? raw.text : "";
  return {id: createHash("sha256").update(url).digest("hex").slice(0, 20), url, title: typeof raw.title === "string" ? raw.title.slice(0, 2000) : new URL(url).hostname, snippet: typeof raw.snippet === "string" ? raw.snippet.slice(0, 8000) : "", providers: [provider], rank,
    ...(request.content === "text" && text ? {content: {text: text.slice(0, max), format: raw.format ?? "text", provider, truncated: text.length > max}} : {}),
    ...(typeof raw.publishedAt === "string" ? {publishedAt: raw.publishedAt.slice(0, 100)} : {})};
}
function mergeSources(groups: Source[][], limit: number): Source[] {
  const merged = new Map<string, {source: Source; score: number}>();
  for (const group of groups) {
    const seen = new Set<string>();
    group.forEach((source, i) => {
      if (seen.has(source.url)) return; seen.add(source.url);
      const old = merged.get(source.url);
      if (old) {
        old.score += 1 / (60 + i + 1); old.source.providers = [...new Set([...old.source.providers, ...source.providers])];
        if (!old.source.content && source.content) old.source.content = source.content;
        if (!old.source.snippet && source.snippet) old.source.snippet = source.snippet;
      } else merged.set(source.url, {source: {...source}, score: 1 / (60 + i + 1)});
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({source}, i) => ({...source, rank: i + 1}));
}
function errorRecord(error: unknown, provider: ProviderId, operation: "search" | "contents"): ProviderError {
  return {provider, operation, code: error instanceof GatewayError ? error.code : "provider_error", retryable: error instanceof UpstreamError ? error.retryable : false};
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new GatewayError("timeout_or_cancelled", "Search deadline exceeded or caller cancelled", 504);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new GatewayError("timeout_or_cancelled", "Search deadline exceeded or caller cancelled", 504));
    signal.addEventListener("abort", abort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function createSearchGateway(config: GatewayOptions = {}) {
  const adapters = config.adapters ?? builtinProviders;
  const enabled = new Set(config.enabledProviders ?? PROVIDERS);
  const fetcher = config.fetch ?? globalThis.fetch;
  const keys = (extra?: ProviderKeys) => ({...config.providerKeys, ...extra});
  function available(extra?: ProviderKeys) { const k = keys(extra); return adapters.filter(p => enabled.has(p.id) && !!k[p.id]); }
  function catalog(): ProviderInfo[] { return adapters.map(p => ({id: p.id, description: p.description, contents: !!p.contents, configured: !!config.providerKeys?.[p.id], enabled: enabled.has(p.id)})); }
  async function extract(request: ContentsRequest, signal: AbortSignal, candidates: SearchProvider[], errors: ProviderError[], attempts: Attempt[]): Promise<Source[]> {
    const eligible = candidates.filter(p => p.contents && (!request.provider || p.id === request.provider));
    if (!eligible.length) throw new GatewayError("no_content_provider", "Configure an enabled provider with URL extraction support", 503);
    const k = keys(request.providerKeys);
    const collected = new Map<string, Source>();
    for (const provider of eligible) {
      const start = Date.now();
      try {
        const remaining = request.urls.filter(url => !collected.has(url));
        const data = await bounded(provider.contents!(remaining, request.maxContentChars ?? 12_000, {key: k[provider.id]!, fetch: fetcher, signal}), signal);
        const wanted = new Set(request.urls);
        const sources = data.sources.map((s, i) => normalize(s, provider.id, i + 1, {content: "text", maxContentChars: request.maxContentChars})).filter((s): s is Source => !!s && wanted.has(s.url) && !!s.content);
        attempts.push({provider: provider.id, operation: "contents", status: "ok", elapsedMs: Date.now() - start});
        for (const source of sources) collected.set(source.url, source);
        if (collected.size === wanted.size || request.provider) return [...collected.values()];
      } catch (e) {
        errors.push(errorRecord(e, provider.id, "contents")); attempts.push({provider: provider.id, operation: "contents", status: "error", elapsedMs: Date.now() - start});
        if (signal.aborted) break;
      }
    }
    return [...collected.values()];
  }
  return {
    providers: catalog,
    async search(input: SearchRequest, opts: {signal?: AbortSignal} = {}): Promise<SearchResponse> {
      const defined = (value: object) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
      const request = validateSearch({...PRESETS.balanced, ...defined(config.defaults ?? {}), ...defined(input)});
      const start = Date.now(); const errors: ProviderError[] = []; const attempts: Attempt[] = []; const warnings: string[] = [];
      const signal = AbortSignal.any([AbortSignal.timeout(request.timeoutMs!), ...(opts.signal ? [opts.signal] : [])]);
      const all = available(request.providerKeys).filter(p => !request.excludeProviders?.includes(p.id));
      const candidates = request.providers ? [...new Set(request.providers)].map(id => {
        const p = all.find(p => p.id === id); if (!p) throw new GatewayError("provider_unavailable", `${id} is disabled or lacks a key`, 503); return p;
      }) : all;
      if (!candidates.length) throw new GatewayError("no_providers", "No enabled provider has credentials", 503);
      const routing = await bounded(route(request, candidates, config.router ?? {}, fetcher, signal, errors), signal);
      const selected = routing.providers.map(id => candidates.find(p => p.id === id)!);
      const k = keys(request.providerKeys); const answers: SearchResponse["answers"] = [];
      const run = async (p: SearchProvider) => {
        const t = Date.now();
        try {
          const data: ProviderResult = await bounded(p.search(request, {key: k[p.id]!, fetch: fetcher, signal}), signal);
          const sources = data.sources.map((s, i) => normalize(s, p.id, i + 1, request)).filter((s): s is Source => !!s && domainAllowed(s.url, request.includeDomains, request.excludeDomains));
          // Answers cannot be safely post-filtered to domain policies. Only expose source records in that case.
          if (data.answer && !request.includeDomains?.length && !request.excludeDomains?.length) answers.push({provider: p.id, text: data.answer.slice(0, 100_000)});
          attempts.push({provider: p.id, operation: "search", status: "ok", elapsedMs: Date.now() - t}); return sources;
        } catch (e) { errors.push(errorRecord(e, p.id, "search")); attempts.push({provider: p.id, operation: "search", status: "error", elapsedMs: Date.now() - t}); return []; }
      };
      const groups: Source[][] = [];
      if (request.mode === "fallback") { for (const p of selected) { const sources = await run(p); groups.push(sources); if (sources.length || signal.aborted) break; } }
      else groups.push(...await Promise.all(selected.map(run)));
      if (!attempts.some(a => a.operation === "search" && a.status === "ok")) throw new GatewayError("all_providers_failed", "All selected search providers failed; check credentials, quotas and provider availability", signal.aborted ? 504 : 502);
      const sources = mergeSources(groups, request.limit!);
      if (request.content === "text" && request.fetchMissingContent !== false) {
        const missing = sources.filter(s => !s.content).slice(0, 20);
        if (missing.length && !signal.aborted) {
          try {
            const retrieved = await extract({urls: missing.map(s => s.url), maxContentChars: request.maxContentChars, providerKeys: request.providerKeys}, signal, all, errors, attempts);
            for (const source of sources) { const content = retrieved.find(s => s.url === source.url)?.content; if (content) source.content = content; }
          } catch (e) { if (e instanceof GatewayError && e.code === "no_content_provider") warnings.push("No enabled extraction provider can retrieve missing page text"); else throw e; }
        }
      }
      if (request.content === "text" && sources.some(s => !s.content)) warnings.push("Some sources have no page content; snippets remain separate");
      if (errors.length) warnings.push("Some provider operations failed; available results are returned");
      if (signal.aborted) warnings.push("The deadline or cancellation interrupted some operations");
      return {id: randomUUID(), query: request.query, sources, answers, routing, attempts, errors, warnings, elapsedMs: Date.now() - start};
    },
    async contents(input: ContentsRequest, opts: {signal?: AbortSignal} = {}): Promise<ContentsResponse> {
      const request = validateContents(input); const start = Date.now(); const errors: ProviderError[] = []; const attempts: Attempt[] = [];
      const signal = AbortSignal.any([AbortSignal.timeout(request.timeoutMs ?? 20_000), ...(opts.signal ? [opts.signal] : [])]);
      const sources = await extract(request, signal, available(request.providerKeys), errors, attempts);
      if (!sources.length && errors.length) throw new GatewayError("all_providers_failed", "Content retrieval failed", signal.aborted ? 504 : 502);
      return {id: randomUUID(), sources: mergeSources([sources], 20), errors, warnings: request.urls.filter(u => !sources.some(s => s.url === u)).map(u => `No page content returned for ${u}`), elapsedMs: Date.now() - start};
    },
  };
}
export {builtinProviders, keysFromEnv, KEY_ENV} from "./providers.js";
export {GatewayError} from "./validation.js";
export {PRESETS, PROVIDERS} from "./types.js";
export type * from "./types.js";
export type {SearchProvider, ProviderContext, ProviderResult, RawSource} from "./providers.js";
export type {RouterOptions, RoutingContext} from "./routing.js";
