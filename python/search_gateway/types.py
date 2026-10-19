"""Transport records mirror the TypeScript/HTTP camelCase contract."""
from typing import Literal, TypedDict, NotRequired

ProviderId = Literal["exa", "tavily", "brave", "serper", "serpapi", "you", "perplexity", "openai", "parallel", "firecrawl", "jina", "linkup", "happenstance"]

class SourceContent(TypedDict):
    text: str
    format: Literal["text", "markdown"]
    provider: ProviderId
    truncated: bool

class Source(TypedDict):
    id: str
    url: str
    title: str
    snippet: str
    providers: list[ProviderId]
    rank: int
    content: NotRequired[SourceContent]
    publishedAt: NotRequired[str]

class ProviderError(TypedDict):
    provider: str
    operation: Literal["search", "contents", "routing"]
    code: str
    retryable: bool

class RoutingDecision(TypedDict):
    router: str
    providers: list[ProviderId]
    reason: str
    confidence: NotRequired[float]

class Attempt(TypedDict):
    provider: ProviderId
    operation: Literal["search", "contents"]
    status: Literal["ok", "error"]
    elapsedMs: int

class Answer(TypedDict):
    provider: ProviderId
    text: str

class SearchResponse(TypedDict):
    id: str
    query: str
    sources: list[Source]
    answers: list[Answer]
    routing: RoutingDecision
    attempts: list[Attempt]
    errors: list[ProviderError]
    warnings: list[str]
    elapsedMs: int

class ContentsResponse(TypedDict):
    id: str
    sources: list[Source]
    errors: list[ProviderError]
    warnings: list[str]
    elapsedMs: int

class ProviderInfo(TypedDict):
    id: ProviderId
    description: str
    contents: bool
    configured: bool
    enabled: bool
