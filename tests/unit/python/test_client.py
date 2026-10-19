"""T2: mock transport and SDK option mapping. No external API requests."""
import asyncio
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from search_gateway import SearchGateway, AsyncSearchGateway, GatewayError, execute_search_tool


class ClientTests(unittest.TestCase):
    def test_options_map_to_camel_case_but_provider_options_stay_native(self):
        client = SearchGateway(api_key="mock", defaults={"max_providers": 2})
        with patch.object(client, "_request", return_value={"sources": []}) as call:
            client.search("query", include_domains=["example.com"], provider_options={"exa": {"category": "news"}}, max_providers=1)
        call.assert_called_once_with("/v1/search", {"query": "query", "maxProviders": 1, "includeDomains": ["example.com"], "providerOptions": {"exa": {"category": "news"}}})

    def test_rejects_unknown_options_and_insecure_remote_gateway(self):
        with self.assertRaises(ValueError):
            SearchGateway(base_url="http://remote.example")
        with self.assertRaises(ValueError):
            SearchGateway().search("x", unknown=True)

    def test_tool_arguments_cannot_override_provider_policy(self):
        with self.assertRaises(ValueError):
            execute_search_tool(SearchGateway(), {"query": "x", "provider_keys": {"exa": "mock"}})

    def test_http_error_does_not_reflect_upstream_message(self):
        client = SearchGateway(api_key="mock")
        error = HTTPError("https://gateway.example", 403, "mock-secret", {}, io.BytesIO(json.dumps({"error": {"code": "provider_forbidden", "message": "mock-secret"}}).encode()))
        with patch.object(client._opener, "open", side_effect=error):
            with self.assertRaises(GatewayError) as caught:
                client.search("x")
        self.assertEqual(caught.exception.code, "provider_forbidden")
        self.assertNotIn("mock-secret", str(caught.exception))

    def test_async_facade_returns_transport_result(self):
        client = AsyncSearchGateway()
        with patch.object(client._sync, "search", return_value={"query": "async"}) as call:
            result = asyncio.run(client.search("async", content="text"))
        self.assertEqual(result["query"], "async")
        call.assert_called_once_with("async", content="text")


if __name__ == "__main__":
    unittest.main()
