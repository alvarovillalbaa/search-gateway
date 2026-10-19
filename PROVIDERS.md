# Provider capabilities

Last updated: 2026-10-19

Adapters follow the primary documentation linked below. Contract tests use fabricated responses and assert request shapes; they do not prove account access or live service compatibility. Provider APIs and entitlements can change.

| Provider | Environment variable | Search page text | URL extraction | Primary documentation |
| --- | --- | --- | --- | --- |
| Exa | `EXA_API_KEY` | Yes, when requested | Yes | [Search](https://exa.ai/docs/reference/search), [contents](https://exa.ai/docs/reference/get-contents) |
| Tavily | `TAVILY_API_KEY` | Raw markdown when requested | Yes | [Search](https://docs.tavily.com/documentation/api-reference/endpoint/search), [extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) |
| Brave | `BRAVE_API_KEY` | Snippets | Via another extractor | [Web search](https://api-dashboard.search.brave.com/documentation/services/web-search) |
| Serper | `SERPER_API_KEY` | Snippets | Via another extractor | [Official API examples](https://serper.dev/) |
| SerpApi | `SERPAPI_API_KEY` | Snippets | Via another extractor | [Google Search API](https://serpapi.com/search-api) |
| You.com | `YOU_API_KEY` | Full-page markdown when requested | Via another extractor | [POST Search](https://you.com/docs/api-reference/search/v1-search) |
| Perplexity | `PERPLEXITY_API_KEY` | Snippets | Via another extractor | [Search API](https://docs.perplexity.ai/api-reference/search-post) |
| OpenAI | `OPENAI_API_KEY` | Generated answer plus cited URLs | Via another extractor | [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search) |
| Parallel | `PARALLEL_API_KEY` | Excerpts | Yes | [Search](https://docs.parallel.ai/api-reference/search/search), [extract](https://docs.parallel.ai/api-reference/extract/extract) |
| Firecrawl | `FIRECRAWL_API_KEY` | Markdown when requested | Yes | [Search](https://docs.firecrawl.dev/api-reference/endpoint/search), [scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape) |
| Jina | `JINA_API_KEY` | Reader markdown | Yes | [Reader/Search source and HTTP usage](https://github.com/jina-ai/reader), [reader API](https://jina.ai/reader/) |
| Linkup | `LINKUP_API_KEY` | Source snippets | Via another extractor | [Search overview](https://docs.linkup.so/pages/documentation/endpoints/search/overview), [reference](https://docs.linkup.so/pages/documentation/endpoints/search/reference) |
| Happenstance | `HAPPENSTANCE_API_KEY` | People/profile metadata | Via another extractor where publicly accessible | [Create search](https://developer.happenstance.ai/api-reference/create-search), [get search](https://developer.happenstance.ai/api-reference/get-search), [OpenAPI](https://developer.happenstance.ai/openapi.json) |

Only the five listed extraction adapters implement `contents`. Search can use any provider and enrich missing page content through a separately enabled extraction provider. The extractor has to be inside the gateway key's scope. The gateway does not fetch arbitrary URLs from its own network. Full page content is best-effort: access restrictions, private pages, PDFs, and vendor truncation can prevent complete retrieval. `truncated` records this gateway's own character truncation; it cannot detect truncation already applied upstream.

Happenstance starts an asynchronous search job and polls its ID until `COMPLETED`, `FAILED`, or the request deadline. A timeout does not cancel a vendor-side job and does not restart it. The adapter returns profile URLs, name, title and company, keeping AI-generated person summaries out of page-text fields. Happenstance access depends on the authenticated account's network/groups; configure `include_my_connections`, `include_friends_connections`, `group_ids`, or `search_everyone` in its native `providerOptions`. It is not a general web index.

OpenAI uses Responses with `web_search`, includes `web_search_call.action.sources`, and reads URL citation annotations. The configurable default search model is `gpt-4.1-mini`; a separate extractor supplies page text. Perplexity uses its Search API rather than a Sonar chat answer. Parallel uses `/v1/search` and `advanced_settings.full_content` for `/v1/extract`.

Provider-native options are optional and not portable. Common examples: Exa `category`/`type`, Tavily `search_depth`/`topic`, Brave `freshness`/`country`, Serper `gl`/`hl`, Perplexity `search_recency_filter`, Parallel `mode`, OpenAI `model`, and Linkup `depth`. Required gateway query/auth fields and mapped limits take precedence. Unsupported native options can be rejected by the upstream service.

## Decision providers

- Jev: `TYPESAFE_API_KEY`, `https://api.typesafe.ai/v1/systemone`, model `jev-latest`. The request uses `state` and a `questions` map; the provider question uses Choice `criteria`, and breadth uses Noul. [Introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [quickstart](https://docs.typesafe.ai/introduction/quickstart), [Choice](https://docs.typesafe.ai/primitives/choice).
- OpenAI Decisions: `OPENAI_API_KEY`, `https://api.openai.com/v1/decisions`, model `gpt-6-luna`. The request uses `input` and a `questions` array, with a Choice and a Predicate. [Official guide](https://developers.openai.com/api/docs/guides/decisions).

The CLI reads these environment variables automatically. In-process Node callers pass them through `router.jevApiKey` and `router.openaiApiKey`. Decision credentials are server configuration, never model tool arguments or browser configuration. Low confidence and invalid choices are recorded as routing errors and trigger the next fallback. The built-in heuristics are available without decision credentials.
