# Contributing

Last updated: 2026-10-19

Use Node 22+ and Python 3.11+. Start with README.md and AGENTS.md. `npm ci` installs development dependencies; SDK runtime dependencies are intentionally minimal.

Run `npm run check`, `npm test`, `npm run test:python`, and `git diff --check` for code changes. Provider tests use fabricated T2 data. Do not add live API requests to default tests or include real search responses or credentials in fixtures.

When adding a provider, cite primary API documentation, update the provider IDs/environment map in Node and the Python transport mirror, document capabilities in PROVIDERS.md, and add request/normalization fixtures. Treat snippets, generated answers and retrieved page content as different fields. Add extraction only when its documented contract is implemented.

For distribution changes, run `npm run schema`, `npm run pack:sdk`, `python -m build python`, and `npm run verify:artifacts`. Commit generated openapi.json alongside its generator. Test actual installable packages in fresh consumers. Do not infer live-provider compatibility from mocked contract tests.
