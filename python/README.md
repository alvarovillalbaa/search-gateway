# search-gateway-client

Last updated: 2026-10-19

Dependency-free Python 3.11+ client for the [Search Gateway](https://github.com/alvarovillalbaa/search-gateway) HTTP service. Install the wheel from the GitHub release, or `pip install ./python` from a source checkout.

```python
from search_gateway import SearchGateway, AsyncSearchGateway

client = SearchGateway()  # SEARCH_GATEWAY_URL and SEARCH_GATEWAY_API_KEY
response = client.search('AI web retrieval', content='text', providers=['exa'])
for source in response['sources']:
    print(source['url'], source.get('content', {}).get('text'))
pages = client.contents(['https://example.com'])
```

Configure defaults with `SearchGateway(defaults={"limit": 5})`. Client options use snake_case; response records preserve camelCase. Provider-native dictionaries in `provider_options` are passed without renaming. Remote gateway URLs must use HTTPS; loopback HTTP is allowed.

`AsyncSearchGateway` exposes async `search`, `contents`, and `providers` methods using `asyncio.to_thread`. Cancelling the coroutine leaves any running urllib request bounded by its socket timeout (`timeout=125.0` by default). There are no automatic retries.

Provider keys belong on the gateway server, or in `provider_keys` on a trusted backend request if the server enables BYOK. A gateway key is still required. This SDK does not operate provider adapters locally; use the Node core or run the self-hosted gateway.

`SEARCH_TOOL` and `CONTENTS_TOOL` contain OpenAI Responses-style function definitions. `execute_search_tool`, `execute_search_tool_async`, and `execute_contents_tool` dispatch tool arguments. The host agent owns the conversation and tool execution loop. Transport records are available from `search_gateway.types`, and the package includes `py.typed`.
