import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {GatewayError, validateSearch, validateContents} from "./validation.js";
import {PROVIDERS, type SearchService, type ProviderInfo, type ProviderId} from "./types.js";
import type {KeyPolicy} from "./keys.js";

export interface ServerOptions {
  gateway: SearchService & {providers(): ProviderInfo[]};
  authenticate: (key: string) => Promise<KeyPolicy | undefined> | KeyPolicy | undefined;
  allowRequestKeys?: boolean;
  allowedOrigins?: string[];
  maxConcurrent?: number;
  maxBodyBytes?: number;
}
async function body(req: IncomingMessage, max: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new GatewayError("body_too_large", "Request body exceeds limit", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GatewayError("invalid_json", "Request body must be JSON"); }
}
/** Authentication is mandatory, including on loopback. Terminate TLS before exposing publicly. */
export function createGatewayServer(options: ServerOptions) {
  if (typeof options.authenticate !== "function") throw new GatewayError("missing_authenticator", "An authenticator is required", 500);
  const buckets = new Map<string, {start: number; count: number}>(); let active = 0;
  return createServer(async (req, res) => {
    let occupied = false;
    const send = (status: number, data: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}); res.end(JSON.stringify(data));
    };
    try {
      if (req.url === "/health" && req.method === "GET") return send(200, {status: "ok", version: "0.1.0"});
      const origin = req.headers.origin;
      if (origin) {
        if (!options.allowedOrigins?.includes(origin)) throw new GatewayError("origin_not_allowed", "Origin not allowed", 403);
        res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      }
      if (req.method === "OPTIONS") return send(204, null);
      const auth = req.headers.authorization;
      const policy = auth?.startsWith("Bearer ") ? await options.authenticate(auth.slice(7)) : undefined;
      if (!policy) throw new GatewayError("unauthorized", "A valid gateway bearer key is required", 401);
      const now = Date.now();
      for (const [id, entry] of buckets) if (now - entry.start >= 60_000) buckets.delete(id);
      if (buckets.size >= 10_000 && !buckets.has(policy.id)) throw new GatewayError("overloaded", "Rate limiter capacity reached", 503);
      const bucket = buckets.get(policy.id) ?? {start: now, count: 0};
      buckets.set(policy.id, bucket); bucket.count++;
      if (bucket.count > policy.requestsPerMinute) { res.setHeader("Retry-After", String(Math.ceil((60_000 - (now - bucket.start)) / 1000))); throw new GatewayError("rate_limited", "Request limit exceeded", 429); }
      const allowed = new Set(policy.providers ?? PROVIDERS);
      if (req.url === "/v1/providers" && req.method === "GET") return send(200, {providers: options.gateway.providers().filter(p => allowed.has(p.id))});
      if (req.method !== "POST" || !["/v1/search", "/v1/contents"].includes(req.url ?? "")) throw new GatewayError("not_found", "Unknown endpoint", 404);
      if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new GatewayError("unsupported_media_type", "Content-Type must be application/json", 415);
      if (active >= (options.maxConcurrent ?? 16)) throw new GatewayError("overloaded", "Concurrent request limit exceeded", 503);
      active++; occupied = true;
      const raw = await body(req, options.maxBodyBytes ?? 65_536);
      const data = (req.url === "/v1/search" ? validateSearch(raw) : validateContents(raw)) as any;
      if (data.providerKeys && !options.allowRequestKeys) throw new GatewayError("request_keys_disabled", "This gateway does not accept per-request provider keys", 403);
      if (data.providerKeys && Object.keys(data.providerKeys).some(p => !allowed.has(p as ProviderId))) throw new GatewayError("provider_forbidden", "Provider is outside the gateway key scope", 403);
      if (Array.isArray(data.providers) && data.providers.some((p: ProviderId) => !allowed.has(p))) throw new GatewayError("provider_forbidden", "Provider is outside the gateway key scope", 403);
      if (data.provider && !allowed.has(data.provider)) throw new GatewayError("provider_forbidden", "Provider is outside the gateway key scope", 403);
      const cancel = new AbortController();
      const onClose = () => { if (!res.writableEnded) cancel.abort(); }; res.on("close", onClose);
      try {
        if (req.url === "/v1/search") {
          const excluded = new Set([...PROVIDERS.filter(id => !allowed.has(id)), ...(Array.isArray(data.excludeProviders) ? data.excludeProviders : [])]);
          send(200, await options.gateway.search({...data, excludeProviders: [...excluded]} as any, {signal: cancel.signal}));
        } else {
          // A scoped key must not use unrestricted fallback extractors.
          const candidates = options.gateway.providers().filter(p => allowed.has(p.id) && p.enabled && p.contents && (p.configured || data.providerKeys?.[p.id]));
          if (!data.provider && policy.providers) data.provider = candidates[0]?.id;
          if (!data.provider && policy.providers) throw new GatewayError("no_content_provider", "No content provider in this key scope", 503);
          send(200, await options.gateway.contents(data as any, {signal: cancel.signal}));
        }
      } finally { res.off("close", onClose); }
    } catch (error) {
      const e = error instanceof GatewayError ? error : new GatewayError("internal_error", "Internal gateway error", 500);
      send(e.status, {error: {code: e.code, message: e.message}});
    } finally { if (occupied) active--; }
  });
}
export {createApiKey, listApiKeys, revokeApiKey, keyStoreAuthenticator} from "./keys.js";
export type {KeyPolicy, KeyRecord} from "./keys.js";
export function closeServer(server: ReturnType<typeof createGatewayServer>) { return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
export type {IncomingMessage, ServerResponse};
