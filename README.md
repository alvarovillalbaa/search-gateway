# Search Gateway

Last updated: 2026-10-19

One interface for AI search. Search across 13 providers, route with Jev and OpenAI Decisions, and retrieve source URLs and page content from TypeScript, Python, React, or agent tools.

Search Gateway is an MIT-licensed, self-hostable gateway and SDK. Run it in-process with your own provider keys, or put an authenticated HTTP gateway in front of your providers and give applications a single gateway key.

**Providers:** Exa, Happenstance, Perplexity, OpenAI, Parallel, Firecrawl, Tavily, Brave, Serper, SerpApi, You.com, Jina, and Linkup. See [capabilities and primary sources](PROVIDERS.md).

## Install

Node.js 22+; Python 3.11+. The first release distributes ready-to-install artifacts through GitHub Releases. npm and PyPI registry publication is separate.

```bash
npm install https://github.com/alvarovillalbaa/search-gateway/releases/download/v0.1.0/alvarovillalbaa-search-gateway-0.1.0.tgz
pip install https://github.com/alvarovillalbaa/search-gateway/releases/download/v0.1.0/search_gateway_client-0.1.0-py3-none-any.whl
```

Or build from source:

```bash
git clone https://github.com/alvarovillalbaa/search-gateway.git
cd search-gateway
npm ci
npm run build
python3 -m pip install ./python
```

## Direct TypeScript / Node usage

This runs in your trusted backend. Set one or more provider environment variables from [.env.example](.env.example).

```ts
import { createSearchGateway, keysFromEnv, PRESETS } from '@alvarovillalbaa/search-gateway/core';

const search = createSearchGateway({
  providerKeys: keysFromEnv(),
  enabledProviders: ['exa', 'tavily', 'parallel', 'firecrawl'],
  defaults: PRESETS.research,
  router: {
    jevApiKey: process.env.TYPESAFE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  },
});

const result = await search.search({
  query: 'Compare approaches to reliable web retrieval for AI agents',
  mode: 'auto',
  limit: 8,
  maxProviders: 2,
  content: 'text',
});
for (const source of result.sources) {
  console.log(source.url, source.content?.text ?? source.snippet);
}

const pages = await search.contents({ urls: result.sources.slice(0, 3).map(s => s.url) });
```

`content` contains provider-retrieved page text. `snippet` is a search excerpt. `answers` contains generated answers when a provider supplies them. Missing content stays missing and produces a warning. Sources retain discovery providers; `content.provider` identifies the extractor.

## One gateway key

Provider accounts are still required. A gateway key authenticates your applications to your gateway; it does not create upstream credits or subscriptions. Provision and revoke keys locally on the gateway host, through the CLI or the server package.

```bash
# From the source checkout (after npm run build):
node packages/search-gateway/dist/cli.js key create --name my-app --providers exa,tavily --rpm 60
# Save apiKey from this one-time output in your application's secret manager.
# Configure upstream keys in .env, then:
node --env-file=.env packages/search-gateway/dist/cli.js serve

# With the npm artifact installed, the same commands are:
npx search-gateway key create --name another-app
npx search-gateway serve
```

The CLI defaults to `127.0.0.1:8787` and `.search-gateway/keys.json`. Only SHA-256 key hashes are stored, in a file with mode `0600`. List keys with `key list`; revoke with `key revoke <id>`. Use `--store <path>` consistently across commands to change the store. Local provisioning is also available as `createApiKey`, `listApiKeys`, and `revokeApiKey` from the `/server` entry point.

```ts
import { SearchGateway } from '@alvarovillalbaa/search-gateway';

const client = new SearchGateway({
  baseUrl: process.env.SEARCH_GATEWAY_URL ?? 'http://127.0.0.1:8787',
  apiKey: process.env.SEARCH_GATEWAY_API_KEY,
  defaults: { content: 'text', limit: 5 },
});
const result = await client.search({ query: 'Reliable AI search patterns' });
```

Remote SDK connections require HTTPS. Bind publicly with `serve --host 0.0.0.0` behind a TLS proxy. The file store and in-memory rate limiter are intended for a single gateway process. For multiple instances, supply your own shared authenticator and external rate limiting. See [security and operations](SECURITY.md).

## Python

The Python SDK uses the same HTTP gateway. It accepts snake_case options and preserves the gateway's camelCase response fields. Provider-specific options retain their native names.

```python
from search_gateway import SearchGateway, AsyncSearchGateway, PRESETS

client = SearchGateway()  # SEARCH_GATEWAY_URL and SEARCH_GATEWAY_API_KEY
result = client.search(
    "Research web retrieval methods",
    **PRESETS["research"],
    providers=["exa", "tavily"],
    include_domains=["arxiv.org", "github.com"],
)
for source in result["sources"]:
    print(source["url"], source.get("content", {}).get("text"))

pages = client.contents(["https://example.com"], provider="exa")

# Inside an async function:
# result = await AsyncSearchGateway().search("Latest retrieval research")
```

There are no Python runtime dependencies. The async facade uses bounded worker-thread requests; cancelling a coroutine does not stop an already-running urllib request. The socket timeout still applies. See [Python package](python/README.md).

## Routing and configuration

| Mode | Execution |
| --- | --- |
| `auto` | Custom function or configured rules, then Jev, then OpenAI Decisions, then built-in capability rules. Can select multiple providers. |
| `single` | First selected provider; no model routing call. |
| `parallel` | Selected providers run concurrently; partial failures return available results. |
| `fallback` | Selected providers run in order until one returns usable sources. |

`providers` narrows the candidates. `excludeProviders` removes candidates. The server's enabled-provider policy and gateway key scope always apply. Providers without credentials cannot be selected. `maxProviders` caps the dispatch count at 1–5 (default 2), including explicit modes. Empty results are a valid outcome. Provider limits can return fewer results than the requested overall `limit`.

Auto routing uses TypeSafe's `/v1/systemone` with a provider Choice and a breadth Noul. A failed, invalid, or low-confidence Jev answer falls back to OpenAI `/v1/decisions`, then rules. Model choices are validated before dispatch. The default confidence threshold is `0.55`; calibrate it against your own workload. Routing responses expose the selected router, reason, providers, and confidence when available. The deterministic fallback is not a learned model.

```ts
const search = createSearchGateway({
  providerKeys: keysFromEnv(),
  defaults: { limit: 10, maxProviders: 3, timeoutMs: 30_000 },
  router: {
    rules: [{ contains: ['official documentation'], providers: ['exa'] }],
    // Or fully own the decision:
    // decide: ({ request, candidates }) => candidates.slice(0, 2).map(p => p.id),
  },
});
const result = await search.search({
  query: 'Latest database research',
  mode: 'parallel', providers: ['exa', 'tavily'],
  excludeDomains: ['unwanted.example'],
  maxContentChars: 15_000,
  providerOptions: { exa: { category: 'research paper' }, tavily: { search_depth: 'advanced' } },
});
```

`PRESETS.fast`, `PRESETS.balanced` (the default), and `PRESETS.research` provide starting points. Defaults are shallow-merged with each request; nested provider options supplied by the request replace the corresponding default object. A request cannot override provider URLs or authentication through provider options. Domain policies are applied to normalized URLs for every provider. Generated answers are omitted under domain filters because post-filtering their claims is not reliable.

Full request/response fields and defaults: [API reference](API.md), [OpenAPI](openapi.json). Server JSON configuration: [example](examples/gateway.json). Environment variables contain credentials; JSON configuration contains policy.

## Bring your own provider keys

For in-process Node usage, pass `providerKeys` to `createSearchGateway` or an individual request. Keys supplied on a call only apply to that call. The HTTP server accepts request keys only when started with `--allow-request-keys` (or `allowRequestKeys: true`). A valid gateway key is still required, and its provider scope still applies.

```python
# Trusted backend only, through an HTTPS gateway with BYOK enabled:
result = client.search("query", providers=["exa"], provider_keys={"exa": "your-provider-key"})
```

Never send upstream keys or a reusable gateway secret to a browser. Use your own authenticated application backend as a proxy.

## React

The optional `/react` entry point provides `useSearchGateway`: data, loading, errors, search, and cancel. It aborts superseded requests and ignores stale results.

Changing `client` clears the hook's visible result, error and busy state and
cancels that client's pending work. Requests started for the replacement client
keep their own loading state. The same client retains its last result while a
new search loads. Callbacks retained for an earlier client stay scoped to that
client and cannot update or cancel the current client's view.

```tsx
import { useMemo } from 'react';
import { SearchGateway } from '@alvarovillalbaa/search-gateway';
import { useSearchGateway } from '@alvarovillalbaa/search-gateway/react';

export function SearchBox() {
  // Your authenticated application backend proxies /api/gateway/v1/*.
  const client = useMemo(() => new SearchGateway({
    baseUrl: new URL('/api/gateway', window.location.origin).href,
  }), []);
  const { data, loading, error, search, cancel } = useSearchGateway(client);
  return <section>
    <form onSubmit={event => {
      event.preventDefault();
      const query = String(new FormData(event.currentTarget).get('query') ?? '');
      void search({ query }).catch(() => {}); // The hook exposes error for rendering.
    }}>
      <input name="query" aria-label="Search query" required />
      <button disabled={loading}>Search</button>
      {loading && <button type="button" onClick={cancel}>Cancel</button>}
    </form>
    {loading && <p role="status">Searching…</p>}
    {error && <p role="alert">Search failed. Please try again.</p>}
    {data && !data.sources.length && <p>No sources found.</p>}
    <ul>{data?.sources.map(source => <li key={source.id}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
      <p>{source.snippet}</p>
    </li>)}</ul>
  </section>;
}
```

Render this example client-side; an SSR framework should create its client after browser mounting or pass a configured client through props. A proxy must authenticate your application's users and enforce its own authorization and spending policy. CORS is not user authentication. Server/core modules are separate exports from the browser client.

## Tool calls and MCP

```ts
import { createSearchTool, createContentsTool } from '@alvarovillalbaa/search-gateway';
const tool = createSearchTool(client, { providers: ['exa'], content: 'text' });
// Send { type, name, description, parameters } to an OpenAI Responses function-calling loop.
// Execute only the returned arguments:
const result = await tool.execute({ query: 'AI retrieval research' });
const read = createContentsTool(client);
```

Python exports `SEARCH_TOOL`, `CONTENTS_TOOL`, `execute_search_tool`, and `execute_search_tool_async`. Anthropic-style tools use `{name, description, input_schema: parameters}`. Tools return structured data; your agent owns the conversation loop. Retrieved text is untrusted input.

The CLI also serves an MCP stdio server with `web_search` and `read_sources`:

```json
{
  "mcpServers": {
    "search-gateway": {
      "command": "npx",
      "args": ["--no-install", "search-gateway", "mcp", "--base-url", "http://127.0.0.1:8787"],
      "env": { "SEARCH_GATEWAY_API_KEY": "your-gateway-key" }
    }
  }
}
```

Install the npm artifact before using this configuration. Omit `--base-url` for direct BYOK through the process's provider environment variables. Keep MCP configuration containing keys outside Git. MCP logs go to stderr; stdout contains JSON-RPC only. The server supports stdio, not MCP HTTP transport.

## Develop and verify

```bash
npm ci
npm run check
npm test
npm run test:python
npm run demo
npm run pack:sdk
python3 -m pip install build
python3 -m build python
git diff --check
```

Tests cover adapters with fabricated provider responses, routing, source semantics, policy boundaries, loopback HTTP, Python SDK calls, React state, key lifecycle, CLI and MCP. The demo uses mock data and no credentials. Live vendor credentials, account-specific entitlements, quotas, latency, and routing quality require your own integration checks. [Architecture](ARCHITECTURE.md) explains the boundaries; [release verification](RELEASE.md) records what was actually checked.

The React client-replacement repair is available in source. Its
[focused evidence](docs/results/2026/10-29/react-client-ownership.md) is separate
from the existing v0.1.0 release artifacts, which were not rebuilt by this work.
