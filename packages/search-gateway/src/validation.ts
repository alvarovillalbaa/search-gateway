import {PROVIDERS, type ContentsRequest, type SearchRequest} from "./types.js";

export class GatewayError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = "GatewayError"; }
}
export function record(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function publicUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !host.includes(".") || /[:\[\]]/.test(host) || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return;
    if (url.port && !["80", "443"].includes(url.port)) return;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return; }
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < min || (value as number) > max)) throw new GatewayError("invalid_request", `${field} must be an integer from ${min} to ${max}`);
}
function providers(value: unknown, field: string) {
  if (value !== undefined && (!Array.isArray(value) || value.length === 0 || value.length > PROVIDERS.length || value.some(x => !PROVIDERS.includes(x)))) throw new GatewayError("invalid_request", `${field} must contain known providers`);
}
const SEARCH_FIELDS = new Set(["query", "mode", "providers", "excludeProviders", "limit", "maxProviders", "content", "maxContentChars", "fetchMissingContent", "includeDomains", "excludeDomains", "timeoutMs", "providerOptions", "providerKeys"]);
export function validateSearch(value: unknown): SearchRequest {
  const r = record(value);
  if (typeof r.query !== "string" || !r.query.trim() || r.query.length > 8000) throw new GatewayError("invalid_request", "query must contain 1 to 8000 characters");
  for (const key of Object.keys(r)) if (!SEARCH_FIELDS.has(key)) throw new GatewayError("invalid_request", `Unknown search field: ${key}`);
  if (r.mode !== undefined && !["auto", "single", "parallel", "fallback"].includes(r.mode)) throw new GatewayError("invalid_request", "Unknown search mode");
  if (r.content !== undefined && !["none", "text"].includes(r.content)) throw new GatewayError("invalid_request", "content must be none or text");
  if (r.fetchMissingContent !== undefined && typeof r.fetchMissingContent !== "boolean") throw new GatewayError("invalid_request", "fetchMissingContent must be boolean");
  providers(r.providers, "providers");
  if (!(Array.isArray(r.excludeProviders) && r.excludeProviders.length === 0)) providers(r.excludeProviders, "excludeProviders");
  integer(r.limit, 1, 50, "limit"); integer(r.maxProviders, 1, 5, "maxProviders");
  integer(r.timeoutMs, 100, 120_000, "timeoutMs"); integer(r.maxContentChars, 1, 100_000, "maxContentChars");
  for (const field of ["includeDomains", "excludeDomains"]) {
    if (r[field] !== undefined && (!Array.isArray(r[field]) || r[field].length > 100 || r[field].some((d: unknown) => typeof d !== "string" || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d)))) throw new GatewayError("invalid_request", `${field} must contain domain names without schemes or paths`);
  }
  validateKeys(r.providerKeys);
  if (r.providerOptions !== undefined) {
    if (r.providerOptions === null || typeof r.providerOptions !== "object" || Array.isArray(r.providerOptions)) throw new GatewayError("invalid_request", "providerOptions must be an object");
    for (const [key, val] of Object.entries(r.providerOptions)) {
      if (!PROVIDERS.includes(key as any) || !val || typeof val !== "object" || Array.isArray(val)) throw new GatewayError("invalid_request", "Invalid providerOptions");
      if (Object.keys(val).some(k => /^(api.?key|authorization|headers|base.?url|endpoint|url|token|access_token)$/i.test(k))) throw new GatewayError("invalid_request", "Provider credentials and endpoints cannot be overridden through providerOptions");
    }
  }
  return {...r, query: r.query.trim()} as SearchRequest;
}
export function validateKeys(value: unknown) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GatewayError("invalid_request", "providerKeys must be an object");
  for (const [key, val] of Object.entries(value)) if (!PROVIDERS.includes(key as any) || typeof val !== "string" || !val.trim() || val.length > 4096) throw new GatewayError("invalid_request", "Invalid providerKeys");
}
export function validateContents(value: unknown): ContentsRequest {
  const r = record(value);
  if (Object.keys(r).some(k => !["urls", "provider", "maxContentChars", "timeoutMs", "providerKeys"].includes(k))) throw new GatewayError("invalid_request", "Unknown contents field");
  if (!Array.isArray(r.urls) || r.urls.length < 1 || r.urls.length > 20 || r.urls.some((u: unknown) => !publicUrl(u))) throw new GatewayError("invalid_request", "urls must contain 1 to 20 public HTTP(S) URLs; IP literals, credentials and custom ports are disallowed");
  if (r.provider !== undefined && !PROVIDERS.includes(r.provider)) throw new GatewayError("invalid_request", "Unknown provider");
  integer(r.timeoutMs, 100, 120_000, "timeoutMs"); integer(r.maxContentChars, 1, 100_000, "maxContentChars"); validateKeys(r.providerKeys);
  return {...r, urls: r.urls.map((u: string) => publicUrl(u)!)} as ContentsRequest;
}
export function domainAllowed(url: string, include: string[] = [], exclude: string[] = []) {
  const host = new URL(url).hostname;
  const matches = (domain: string) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`);
  return (!include.length || include.some(matches)) && !exclude.some(matches);
}
