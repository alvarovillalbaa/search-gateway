# Security and operations

Last updated: 2026-10-19

Keep provider credentials and gateway keys in your server-side secret manager. Never put them in React props, public environment variables, source control or MCP configuration committed to Git. `.env*` and `.search-gateway/` are ignored by default. Only `.env.example` is tracked.

## Deploying

The CLI binds to loopback by default, requires at least one non-revoked gateway key, and authenticates all `/v1/*` endpoints. Use a TLS proxy for external connections. SDKs reject remote plain HTTP and credential-bearing redirects. The gateway health endpoint is public and contains no credential/provider configuration.

Origins are denied unless explicitly allowed. CORS is an additional browser boundary; it does not authenticate your users. Browser applications should call their own authenticated backend, which authorizes requests and adds the gateway key. Do not expose the gateway as an unmetered public proxy.

The local key store belongs to the gateway host and uses a private file mode. Store paths must not be shared with untrusted local writers. Local provisioning APIs have filesystem authority, not remote admin endpoints. Key files and their immediate directory may not be symlinks. A stale `.lock` left by a terminated CLI writer needs operator inspection; verify no writer remains before removing the lock. There is no automatic lock stealing.

Per-key provider scope applies to search and extraction, including per-request BYOK. The server ignores no policy boundary: disabled providers remain disabled even if a request supplies keys. BYOK HTTP requests require explicit opt-in. Provider keys are request-local and not cached. Rotate upstream credentials in your runtime environment and restart the gateway after updating them.

Rate limiting and concurrency counters are local to one process. Use shared external controls for multi-instance deployment. Logs in an external proxy must redact Authorization headers, request bodies and URLs containing credentials. SerpApi requires an upstream API key in its query string; this gateway never logs it, and adapter failures use safe error codes.

## Retrieved content

Every source is untrusted content. Do not execute instructions in snippets, markdown, provider-generated answers or profile summaries. Route decisions are bounded provider selections, not arbitrary model-issued network calls. Applications decide what to render, quote, store or send to another model.

Only public HTTP(S) source URLs are accepted; userinfo, IP literals, local hostnames and custom ports are blocked. Source URL fetching is delegated to fixed provider endpoints. There is no direct server-network URL fetch fallback. Upstream extractors remain responsible for their network access controls and target access permissions. This is not a guarantee that every domain resolves publicly or that every returned page is complete.

## Reporting

For a vulnerability, use GitHub's private vulnerability reporting on the repository when available, or contact the maintainer privately before disclosing credentials or sensitive data. Do not include live tokens or customer search responses in public issues.
