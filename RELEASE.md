# Release verification

Last updated: 2026-10-19

Version: 0.1.0. The initial delivery includes source, an npm tarball, and a Python wheel/source distribution. Registry publication and a managed hosted service are separate from GitHub delivery.

## Requirement coverage

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Sources and their content | Normalized source records, five extraction adapters, optional search enrichment | Provider/content tests; HTTP SDK integration |
| TypeScript/npm | ESM package with client, core, server, tool and type entry points | Strict compile, npm pack, isolated installation and in-process artifact call |
| Python | Typed sync SDK, thread-backed async SDK, provider options and tools | Five unit tests, sync/async loopback HTTP calls, isolated wheel installation |
| React | Optional hook with loading/error/cancel/latest-response behavior | React DOM/jsdom state and race checks |
| Provider breadth | 13 search adapters, including all six requested providers | Registry coverage and outbound/normalization contract tests per provider |
| Regular calls and tool calls | SDK functions, tool definitions/handlers, MCP stdio | Core tools, Python handlers, MCP handshake/list/call over the local gateway |
| Single key and BYOK | Local key CLI/API, hashed store, revocation, scopes, optional request keys | CLI lifecycle, key-file modes, HTTP auth/scope/rate/BYOK checks |
| Enable/disable providers | Server allowlist, per-key scope, request selection/exclusion | Policy and unavailable-provider tests |
| Intelligent auto routing | Jev first, OpenAI Decisions fallback, deterministic fallback, custom rules/function | Mocked schema assertions, low-confidence fallback, invalid-choice rejection, multiple-provider routing |
| Parallel and ordered execution | Parallel and fallback modes, source fusion, partial failures | Barrier-based concurrency and fallback stopping tests |
| Defaults and call configuration | Three presets, instance defaults, per-call overrides/native options | Request validation, contract tests and documented JSON config |
| GitHub delivery | Repository and versioned release artifacts | [Repository](https://github.com/alvarovillalbaa/search-gateway), [release](https://github.com/alvarovillalbaa/search-gateway/releases/tag/v0.1.0) |

## Local proof

- `npm run check`: strict TypeScript compilation passed.
- `npm test`: 50 checks passed, using fabricated T2 provider data and loopback HTTP, including idle-process deadline and pre-dispatch cancellation regressions.
- `npm run test:python`: 5 checks passed.
- `npm run demo`: credential-free fabricated search/tool result passed.
- `npm run schema`: OpenAPI generated from the provider registry and wire fields.
- `npm run pack:sdk`: npm tarball built. A task-local npm cache was used because the global npm cache is not writable.
- Python build: wheel and source distribution built with `build`/Hatchling. Local pip could not resolve PyPI; build-tool wheels were retrieved from PyPI's official files host, SHA-256 checked against PyPI metadata, and installed without network resolution.
- Isolated artifact checks passed npm/Python installation, imports, CLI help and in-process package behavior locally. The local sandbox denied the strengthened installed-artifact HTTP check a loopback listener (`EPERM`); both hosted CI jobs subsequently passed that exact check.
- `npm audit --omit=dev`: no reported runtime dependency vulnerabilities. Both SDKs have no mandatory third-party runtime dependencies.
- `git diff --check`: passed before publication.

## Hosted proof

[Verify run 39237007344](https://github.com/alvarovillalbaa/search-gateway/actions/runs/39237007344) passed on code commit `b08876dacf44958b19ec713dc7c83cd813e46b44` in both Node 22/Python 3.11 and Node 24/Python 3.14. Each job passed compilation, all 50 JavaScript checks, all five Python checks, schema drift, the demo, both package builds, isolated installed-package HTTP calls and the diff check.

The first CI run exposed an idle-process deadline issue on Node 22: an unreferenced AbortSignal timeout did not keep a pending custom adapter alive. The engine now owns and clears a referenced deadline timer. The regression remains enabled; no check was removed or retried to hide that failure.

## Proof boundaries

No live provider, Jev, or OpenAI request was made. The user explicitly chose to add credentials later and authorized mocked verification. Vendor account access, billing, quotas, response drift, routing relevance and latency remain unverified until live integration checks are run with the intended accounts.

The HTTP service is self-hosted and intended to run as one gateway process with external TLS termination. There is no deployed managed service, provider-credit marketplace, currency-budget enforcement, or npm/PyPI registry release. GitHub release assets provide installable packages without requiring registry credentials.

The GitHub workflow runs on Node 22/Python 3.11 and Node 24/Python 3.14. It includes compilation, contract/unit/integration/adversarial checks, schema drift, demo, package builds, and isolated artifact HTTP verification. Inspect its actual run status rather than inferring a hosted pass from this document.
