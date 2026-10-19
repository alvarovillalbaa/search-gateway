import {readJson, type Fetch} from "./http.js";
import {GatewayError} from "./validation.js";
import type {ContentsRequest, ContentsResponse, ProviderInfo, SearchRequest, SearchResponse, SearchService} from "./types.js";

export interface ClientOptions {baseUrl: string; apiKey?: string; defaults?: Partial<SearchRequest>; fetch?: Fetch; timeoutMs?: number}
function validateBaseUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || url.search || url.hash) throw new GatewayError("invalid_base_url", "Use an HTTP(S) base URL without credentials, query or fragment");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new GatewayError("insecure_base_url", "Remote gateway connections require HTTPS");
  return url.href.replace(/\/$/, "");
}
export class SearchGateway implements SearchService {
  private baseUrl: string;
  constructor(private options: ClientOptions) { this.baseUrl = validateBaseUrl(options.baseUrl); }
  private async request<T>(path: string, data?: unknown, options: {signal?: AbortSignal} = {}): Promise<T> {
    const signal = AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs ?? 125_000), ...(options.signal ? [options.signal] : [])]);
    let response: Response;
    try { response = await (this.options.fetch ?? globalThis.fetch)(`${this.baseUrl}${path}`, {method: data ? "POST" : "GET", headers: {...(this.options.apiKey ? {Authorization: `Bearer ${this.options.apiKey}`} : {}), ...(data ? {"Content-Type": "application/json"} : {})}, ...(data ? {body: JSON.stringify(data)} : {}), redirect: "error", signal}); }
    catch { throw new GatewayError(signal.aborted ? "timeout_or_cancelled" : "network_error", "Gateway connection failed", 502); }
    const result = await readJson(response);
    if (!response.ok) throw new GatewayError(typeof result.error?.code === "string" ? result.error.code : "gateway_error", `Gateway request failed (${response.status})`, response.status);
    return result as T;
  }
  search(request: SearchRequest, options?: {signal?: AbortSignal}): Promise<SearchResponse> { return this.request("/v1/search", {...this.options.defaults, ...request}, options); }
  contents(request: ContentsRequest, options?: {signal?: AbortSignal}): Promise<ContentsResponse> { return this.request("/v1/contents", request, options); }
  async providers(): Promise<ProviderInfo[]> { return (await this.request<{providers: ProviderInfo[]}>("/v1/providers")).providers; }
}
export {GatewayError} from "./validation.js";
export {PROVIDERS, PRESETS} from "./types.js";
export type * from "./types.js";
export {createSearchTool, searchToolDefinition, contentsToolDefinition, createContentsTool} from "./tools.js";
