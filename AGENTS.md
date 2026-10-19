# Working in Search Gateway

Last updated: 2026-10-19

Read README.md, then the closest package README before changing behavior. Preserve the public JSON contract in packages/search-gateway/src/types.ts and python/search_gateway/types.py together.

- Keep provider credentials on the server. Browser code imports the HTTP client or React entry point only.
- Never put secrets, local key stores, or real search responses into Git.
- Provider endpoints and authentication must follow the primary documentation linked in PROVIDERS.md.
- Routing must only choose enabled, configured providers; validate all model decisions before execution.
- Source content, snippets, and generated answers are separate fields. Never label a snippet as full page content.
- Use apply_patch for manual edits. Keep runtime dependencies small.
- Verification is authorized for this new standalone project: run npm run check, npm test, and Python unittest discovery after relevant changes. Tests use mock data (T2); no paid API calls without user authorization.
- Run git diff --check before publication. Verify packed npm and Python artifacts, not only source imports.

This project has no authority to change sibling repositories or provision hosted services.
