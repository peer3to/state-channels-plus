# Review service implementation

Operational setup, failure recovery and acceptance are in [the operations guide](../../docs/pr-review-bot.md). The existing worker enables this handler with `--review`; Codex runs from PATH as the worker user.

## Owners

| Operation | Owner |
| --- | --- |
| Existing authenticated peer lifecycle, framing, identities and authorization | `../e2e-parallel/distributed/{poolTransport,protocol,authentication,orchestratorIdentity,authorizationStore}.js` |
| Review negotiation, bounded transfer and authenticated progress | `transport.js` |
| Request/result/correction/receipt validation | `protocol.js`, with the published contract in `schema/review-v1.json` |
| Fixed request construction and bundle digest | `request.js` |
| Admission, PR exclusion, immutable attempts, queue and correction budget | `server.js`, `sessions.js`, `timing.js` |
| Controlled Git preparation and owned removal | `worktrees.js` |
| Source-only tools and public context | `source-tools.js`, `github-read.js` |
| Pinned native session/process operations | `adapters/codex.js` |
| CI-authenticated GitHub reads and every GitHub mutation | `github-write.js` |
| Publication policy, private journal, reconciliation and advisory Human labels | `publish.js`, `publication-store.js`, `state.js`, `reconcile.js`, `approval.js` |
| Report parsing, diff targets and canonical Human rendering | `review-format.js` |
| Data artifact validation, receipt delivery and exact artifact removal | `handoff.js`, `persist.js`, `artifacts.js` |
| Manifest-bound local lifecycle cleanup | `cleanup.js` |

The service/client/model dependency graph must not reach the CI mutation owner. Shared peer code rejects review frames by default; review connections explicitly opt in. No review flow takes a test lease or changes worker queue semantics.

## Request consumers

`repository` and `pr` select the configured public origin, PR owner and publication target. `head` pins Git preparation, native review and publication. `mergeBase` pins source comparison; `base` is provenance. `attempt`, `run`, `caller` and `mode` bind authenticated delivery, durable replay, CI-only correction and publication. `botRevision`, `skillDigest`, `policyDigest` and `runtime` must match the deployed service. `operations` and `readScope` limit review intent/tools and participate in the effective identity. The protocol rejects additional fields, including removed prior-state hints, arbitrary prompts, credentials, commands, URLs and paths.

The service policy digest binds the checked-in review limits. Repository identity is bound separately in every request. Specification generators are excluded; current specification approval remains a separate CI publisher check.

Source evidence retains raw response revision hashes and semantic context hashes. Only PR target-base SHA is removed from the latter. Evidence includes actual request/page/byte counts, configured limits, zero cache hits when no cache is used, pagination links, loaded-content availability and phase durations. A source marked unknown or an unfetched next page cannot support complete coverage. Evidence identity uses the latest observed revision per URL; it is not an atomic GitHub snapshot.

Native session state and the publication journal belong to the PR owner on the worker and may contain unpublished work. CI checkpoints publication through authenticated service calls; GitHub contains only findings and small identity markers. Receipts and current GitHub observations establish which actions succeeded. Neither native memory nor a request hint proves publication. Startup quarantines unfinished native ownership instead of assuming a crashed child stopped. CI receives result/report/publication data, never native archives.

## Vendored maintenance boundary

`skill/provenance.json` records the coding-skills source commit, copied-file hashes and the original manual publisher hash. The bundled PR review skill, inherited implementation-review lenses, example, prose rules/evaluation and publishing contract remain independently maintained here. Automation overrides repository execution/test/publishing instructions and paths. The CommonJS parser/diff and CI preflight/batch owners are ports from the manual ESM publisher; this is necessary duplication across independent repositories. The sibling manual publisher and Studio extension are unchanged.

Root dependencies are reused: Node 22.12.0, Mocha, `@hyperswarm/dht` and the existing YAML parser from the root lockfile. There is no nested package or contract-build prerequisite. The detached CommonJS DHT fixture uses the installed library directly. That library rejects positional port zero; the fixture supplies an ephemeral-range preference with library collision fallback and uses the actual bound port. It owns and awaits destruction of every peer/bootstrapper.

Run `yarn review-bot:test --grep '<literal case>'` for a focused check, and `yarn review-bot:test` for all detached logic/integration cases. Explicit live acceptance uses `yarn review-bot:test:e2e`; no missing native/live input counts as a pass. Existing SDK/farm tests keep their own runner and preparation. Review runs independently in `review.yml`; normal CI retains bot regression tests without depending on native review or publication.

## Worker and CI integration

The normal worker owns the pool, peer identity, authentication, authorization store, connection deduplication, heartbeats and shutdown. `--review` initializes the review handler below the worker work root and advertises the review topic pair. Authenticated `REVIEW_*` messages are dispatched before test lease handling. `ReviewService.attach` uses the existing protocol peer; it opens no second pool and performs no second authentication.

CI and local clients use the existing orchestrator identity. Discovery uses the review topic pair and capability negotiation; no review-specific seed, public key, server pin or policy JSON is configured. The fixed Codex adapter uses the existing worker user's login with only PATH, HOME and optional CODEX_HOME passed to its process. This is source-tool restriction, not separate OS-user isolation.

Publication uses the publisher job's `GITHUB_TOKEN`, with pull requests write and issues write. Credentials remain step-scoped. The model job remains read-only; result artifacts expire after one day without a cleanup job. Receipt delivery runs directly in the publish job. Enable the repository's Actions approval setting. See [first live run](../../docs/pr-review-bot.md#first-live-run).

Human-decision markers are guidance for people and implementing agents. The reviewer assesses ordinary discussion; the publisher does not authenticate Human replies or query maintainer permissions. No review enablement variable or maintainer list is needed.
