# React client replacement

29 October 2026. Started from clean personal main
`f891c1378ca20fb90e007d9dc9610aa4740dfc45`; the remote head matched.

Replacing a client while searching aborted the old request and invalidated its
generation, but left `loading` true. The old request's fenced `finally` could
not restore idle state, leaving the documented Search button disabled. Cleanup
also used the latest global controller, so work started for a replacement in a
child layout effect could be cancelled by old passive cleanup.

The hook now keeps a separate request/state owner per client. Replacement hides
the prior data/error/busy snapshot immediately. Cleanup invalidates and aborts
only its captured owner; passive setup publishes any new-client work already
started. Ownership changes before abort so synchronous abort listeners preserve
newer work. Same-client last-result retention and caller-owned promises remain.
Callbacks explicitly retained for an old client can still call that client,
but cannot publish into or cancel the current view. Public return fields and
transport types, dependencies, providers and Auth are unchanged.

The [machine report](react-client-ownership-checks.json) records one baseline
reproduction against the exact original TypeScript source: the client-swap case
failed with `ERR_ASSERTION`, actual loading `true`, expected `false`. The ten
focused cases then passed against the actual repaired source, with zero
failures, cancellations, skips or TODOs. They use real React DOM, jsdom and
controlled promises, including stale results/errors/cancel, layout requests,
StrictMode/unmount, overlap, retained data and synchronous abort reentry.

Execution used existing Node 26.8.2, React/ReactDOM 19.3.1 and jsdom 30.1.3.
The hook was imported through native TypeScript support; existing `dist` output
was not used. No environment was installed or changed. The exact focused command
set a 15-second per-test timeout for all ten Search cases:

```sh
node --test --test-timeout=15000 --test-concurrency=1 --test-reporter=tap \
  tests/unit/react-client-ownership.test.mjs
```

A targeted strict TypeScript 7.0.2 no-emit check of the hook and its type imports
passed, as did syntax and whitespace checks. Forty-eight other tracked baseline
files match byte-for-byte, including provider/server/wire/Python contracts,
package manifests/lock and the existing workflow. Independent review found no
further concrete lifecycle defect. The report matches all literal source case
names to raw TAP, records source/output hashes and retains normalized TAP with
the private workspace root removed.

Storage Guard returned 29.4 GiB free versus 34.0 GiB required. No emitted package
or application build, dependency installation, backend/provider suite, Python
suite, HTTP server, browser engine, model or paid call ran. React 18, other
runtime versions, fresh distributable/consumer installation and live-provider
acceptance remain unverified. Existing v0.1.0 artifacts were not rebuilt or
published by this work; README notices distinguish source from those artifacts.

The first report-extraction wrapper had an escaped-regex error before writing
any report. Its correction matched the same retained outputs; no test rerun or
product repair was needed. Source publication will use `[skip actions]` so it
does not broaden this focused check into the existing full CI matrix. No
workflow or provider configuration was changed.

Source and evidence were published at `25ce9b8e733a334cdb35399bf116a1077f649266`. All 55 local/remote
leaf identities (path, mode, type and blob SHA) matched an untruncated GitHub
tree and its main ref; zero Actions runs were returned. The
[publication receipt](react-client-ownership-publication.json) separates that
source proof from package/runtime release acceptance. Five operation-owned
baseline/raw-output files were removed after digest, identity and open-handle
checks, preserving the published normalized evidence and all actual source.
