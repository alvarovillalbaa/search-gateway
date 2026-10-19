"""Dependency-free sync client and a bounded thread-backed async client."""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .types import ContentsResponse, ProviderInfo, SearchResponse

_FIELDS = {
    "mode", "providers", "exclude_providers", "limit", "max_providers", "content",
    "max_content_chars", "fetch_missing_content", "include_domains", "exclude_domains",
    "timeout_ms", "provider_options", "provider_keys",
}
_CAMEL = {name: name.split("_")[0] + "".join(part.title() for part in name.split("_")[1:]) for name in _FIELDS}
PRESETS: dict[str, dict[str, Any]] = {
    "fast": {"mode": "single", "limit": 5, "content": "none", "max_providers": 1, "timeout_ms": 10_000},
    "balanced": {"mode": "auto", "limit": 10, "content": "none", "max_providers": 2, "timeout_ms": 20_000},
    "research": {"mode": "auto", "limit": 15, "content": "text", "fetch_missing_content": True, "max_providers": 3, "max_content_chars": 20_000, "timeout_ms": 45_000},
}


class GatewayError(Exception):
    def __init__(self, code: str, status: int = 0) -> None:
        self.code = code
        self.status = status
        super().__init__(f"Search Gateway: {code} (HTTP {status})")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: Any, msg: Any, headers: Any, newurl: Any) -> None:
        return None


def _wire(options: dict[str, Any]) -> dict[str, Any]:
    unknown = set(options) - _FIELDS
    if unknown:
        raise ValueError(f"Unknown search options: {', '.join(sorted(unknown))}")
    return {_CAMEL[key]: value for key, value in options.items() if value is not None}


class SearchGateway:
    """Call a gateway over HTTPS (loopback HTTP is allowed).

    Provider-specific dictionaries retain their native field names. Use provider_keys
    only in trusted backend processes, with per-request keys enabled on the gateway.
    """
    def __init__(self, base_url: str | None = None, api_key: str | None = None, *,
                 defaults: dict[str, Any] | None = None, timeout: float = 125.0) -> None:
        self.base_url = (base_url or os.environ.get("SEARCH_GATEWAY_URL", "http://127.0.0.1:8787")).rstrip("/")
        url = urlsplit(self.base_url)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Use an HTTP(S) base URL without credentials, query or fragment")
        if url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Remote gateway connections require HTTPS")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.api_key = api_key if api_key is not None else os.environ.get("SEARCH_GATEWAY_API_KEY")
        self.defaults = dict(defaults or {})
        _wire(self.defaults)
        self.timeout = timeout
        self._opener = build_opener(_NoRedirect())

    def _request(self, path: str, data: dict[str, Any] | None = None) -> Any:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.base_url + path, data=json.dumps(data).encode() if data is not None else None,
                          headers=headers, method="POST" if data is not None else "GET")
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8_000_001)
        except HTTPError as exc:
            try:
                payload = json.loads(exc.read(65_536))
                code = payload.get("error", {}).get("code", "gateway_error")
                if not isinstance(code, str) or len(code) > 100:
                    code = "gateway_error"
            except (ValueError, AttributeError):
                code = "gateway_error"
            finally:
                exc.close()
            raise GatewayError(code, exc.code) from None
        except (URLError, TimeoutError, OSError):
            raise GatewayError("network_error") from None
        if len(raw) > 8_000_000:
            raise GatewayError("response_too_large")
        try:
            return json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise GatewayError("invalid_response") from None

    def search(self, query: str, **options: Any) -> SearchResponse:
        return cast(SearchResponse, self._request("/v1/search", {"query": query, **_wire({**self.defaults, **options})}))

    def contents(self, urls: list[str], *, provider: str | None = None,
                 max_content_chars: int | None = None, timeout_ms: int | None = None,
                 provider_keys: dict[str, str] | None = None) -> ContentsResponse:
        data: dict[str, Any] = {"urls": urls}
        data.update({key: val for key, val in {"provider": provider, "maxContentChars": max_content_chars,
                    "timeoutMs": timeout_ms, "providerKeys": provider_keys}.items() if val is not None})
        return cast(ContentsResponse, self._request("/v1/contents", data))

    def providers(self) -> list[ProviderInfo]:
        return cast(list[ProviderInfo], self._request("/v1/providers")["providers"])


class AsyncSearchGateway:
    """Async facade using asyncio.to_thread; cancellation does not terminate an in-flight
    urllib request. Network work remains bounded by the client's socket timeout.
    """
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._sync = SearchGateway(*args, **kwargs)

    async def search(self, query: str, **options: Any) -> SearchResponse:
        return await asyncio.to_thread(self._sync.search, query, **options)

    async def contents(self, urls: list[str], **options: Any) -> ContentsResponse:
        return await asyncio.to_thread(self._sync.contents, urls, **options)

    async def providers(self) -> list[ProviderInfo]:
        return await asyncio.to_thread(self._sync.providers)
