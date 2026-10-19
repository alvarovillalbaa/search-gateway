# API reference

Last updated: 2026-10-19

The HTTP gateway accepts JSON and requires `Authorization: Bearer <gateway-key>` on `/v1/*`. `GET /health` is public and exposes status and package version. Schemas: [openapi.json](openapi.json). TypeScript types: [types.ts](packages/search-gateway/src/types.ts). Python transport types: [types.py](python/search_gateway/types.py).

## POST /v1/search

| Field | Default | Meaning |
| --- | --- | --- |
| `query` | Required | Non-empty string, at most 8,000 characters. |
| `mode` | `auto` | `auto`, `single`, `parallel`, `fallback`. |
| `providers` | Configured, enabled providers | Non-empty list of provider IDs, in preferred order. Duplicates are deduplicated. |
| `excludeProviders` | `[]` | Remove providers, including from content enrichment. |
| `limit` | `10` | Maximum merged sources, 1–50. Provider limits can yield fewer. |
| `maxProviders` | `2` | Maximum dispatched search providers, 1–5. |
| `content` | `none` | `none` for snippets, `text` to request page text. |
| `maxContentChars` | `12000` | Per-source returned content character cap, 1–100000. |
| `fetchMissingContent` | `true` | Enrich missing text through an available extractor when `content=text`. |
| `includeDomains` | `[]` | Allow only these domains and their subdomains. |
| `excludeDomains` | `[]` | Exclude these domains and their subdomains. Each domain list has at most 100 entries. |
| `timeoutMs` | `20000` | Overall operation deadline, 100–120000 milliseconds. |
| `providerOptions` | `{}` | Provider ID to native search options. Endpoint and authentication overrides are rejected. |
| `providerKeys` | `{}` | Optional per-call BYOK in a trusted backend. HTTP requires explicit server opt-in. |

Instance defaults precede request overrides. `providers` narrows routing candidates; extraction can still use other enabled providers unless excluded. Key scopes and server enablement cap both search and extraction. Requests cannot expand those policies. `maxProviders` caps search dispatch, not the number of extraction HTTP calls. Enrichment attempts up to 20 missing URLs per search; a configured extractor may issue one request per URL. Set `fetchMissingContent=false` to avoid enrichment calls, or `content=none` to use snippets. No automatic retries occur; fallback mode and extraction fallback may call other providers.

```bash
curl http://127.0.0.1:8787/v1/search \
  -H "Authorization: Bearer $SEARCH_GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"AI web retrieval","providers":["exa","tavily"],"mode":"parallel","content":"text"}'
```

The response contains:

- `id`, `query`, `elapsedMs`.
- `sources`: normalized records containing `id`, `url`, `title`, `snippet`, discovery `providers`, `rank`, optional `publishedAt`, and optional `content`. Content has `text`, `format` (`text` or `markdown`), `provider`, and `truncated`. `publishedAt` preserves the provider's string and is not guaranteed to be ISO 8601.
- `answers`: `{provider, text}` generated answer records. Under a domain policy these are omitted; source records are post-filtered.
- `routing`: `router`, selected `providers`, `reason`, and optional `confidence`.
- `attempts`: provider, operation, status and elapsed time for actual search/extraction attempts. Routing attempts are recorded through `routing` and routing `errors`.
- `errors`: safe provider error codes with provider, operation and retryability, without upstream error bodies.
- `warnings`: missing content, partial provider failures or deadline/cancellation information.

URL normalization strips fragments and common tracking parameters. Reciprocal-rank fusion merges source URLs and accumulates discovery provenance. It does not imply factual verification or cross-provider confidence. Retrieved text is untrusted data.

## POST /v1/contents

`urls` is required: 1–20 public HTTP(S) URLs. Optional `provider`, `maxContentChars` (12000), `timeoutMs` (20000), and `providerKeys`. Credentials in URLs, IP literals, local hostnames and custom ports are rejected. The gateway delegates extraction to fixed vendor API endpoints; it never fetches these source URLs directly.

When `provider` is omitted, extraction providers are tried in registry order to fill missing URLs. An explicit provider disables cross-provider fallback. A scoped HTTP key without an explicit provider uses the first authorized, configured extractor. The result contains `id`, `sources`, `errors`, `warnings`, and `elapsedMs`. Missing pages have warnings; partial results remain usable.

## GET /v1/providers

Returns `{providers: [{id, description, contents, configured, enabled}]}`. Results are filtered to the gateway key's provider scope. No provider keys, gateway key hashes or routing credentials are exposed.

## Errors and limits

Errors use `{error: {code, message}}`. Common HTTP statuses: `400` invalid request, `401` missing/revoked key, `403` scope/origin/BYOK policy, `413` oversized body, `415` wrong content type, `429` per-key rate limit, `502` all upstream operations failed, `503` unavailable provider/overload, and `504` deadline exceeded without usable results. `429` includes `Retry-After` seconds. Successfully completed empty searches return `200` and an empty source list.

The SDK throws `GatewayError` with `code` and `status`; it does not reflect upstream error messages. Inspect `errors` and `warnings` on successful partial responses. Direct core exceptions follow the same error class.

The server defaults to a 64 KiB request body cap, 16 concurrent requests, and each key's configured rate limit (60/minute by default). Rate limits are in-memory, per process, and reset on restart. The SDK caps decoded response JSON at 8 MB. Content and responses are not cached. There is no usage billing or currency estimate.

## Server configuration

`createGatewayServer({gateway, authenticate, allowRequestKeys?, allowedOrigins?, maxConcurrent?, maxBodyBytes?})` returns a Node HTTP server. Authentication is mandatory. `authenticate` returns `{id, name, providers?, requestsPerMinute}` or `undefined`; use `keyStoreAuthenticator(path)` for the local store. Start it with `.listen(port, host)` and shut it down using `.close()` or `closeServer(server)`.

`createSearchGateway({providerKeys?, enabledProviders?, defaults?, router?, fetch?, adapters?})` returns the in-process engine. `adapters` is a trusted server extension point; it replaces the registry. Custom adapters must respect AbortSignal and use the normalized raw-source contract. The gateway bounds waiting on even non-cooperative adapters, but cannot stop their external side effects.

The HTTP client's `{baseUrl, apiKey?, defaults?, fetch?, timeoutMs?}` uses a 125-second transport timeout by default. `search` and `contents` accept `{signal}` as a second argument. Only omit the HTTP client API key when an authenticated application backend is supplying it. Python constructor options are `base_url`, `api_key`, `defaults`, and socket `timeout` seconds.
