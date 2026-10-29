# @alvarovillalbaa/search-gateway

Last updated: 2026-10-19

AI search across 13 providers, with source retrieval, Jev-first routing, OpenAI Decisions fallback, BYOK, a gateway server, CLI, React hook and MCP stdio.

Install the `.tgz` artifact from the [GitHub release](https://github.com/alvarovillalbaa/search-gateway/releases/latest). Node.js 22+ is required. React 18+ is optional and only needed for `/react`.

```ts
import { createSearchGateway, keysFromEnv } from '@alvarovillalbaa/search-gateway/core';
const search = createSearchGateway({ providerKeys: keysFromEnv() });
const result = await search.search({ query: 'AI web retrieval', content: 'text' });
```

Entry points:

- `@alvarovillalbaa/search-gateway`: browser-safe HTTP client, tool definitions, public types and presets.
- `/core`: Node provider engine and routing. Provider keys stay here, on the server.
- `/server`: Node HTTP server and local gateway-key provisioning.
- `/react`: `useSearchGateway` with loading/error/cancel/latest-request state.
- `search-gateway`: CLI (`--help` lists commands), including `mcp` for stdio tool calls.

For HTTP usage, create a key locally with `search-gateway key create`, set upstream provider environment variables, then run `search-gateway serve`. Applications use the single gateway key. The gateway is self-hosted; upstream accounts and billing remain yours.

The React hook resets visible state when its client changes and scopes pending
requests and cancellation to that client. Same-client searches retain the last
result while loading. The client-replacement repair is source-only; existing
v0.1.0 release artifacts were not rebuilt. See the
[focused evidence](https://github.com/alvarovillalbaa/search-gateway/blob/main/docs/results/2026/10-29/react-client-ownership.md).

Full setup, Python and React examples, API details, provider capability table and verification boundaries are in the [repository documentation](https://github.com/alvarovillalbaa/search-gateway#readme).
