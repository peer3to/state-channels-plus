# Review service implementation

Operational setup, failure recovery and acceptance are in [the operations guide](../../docs/pr-review-bot.md). The existing worker enables this handler with `--review-codex [model]` (default `gpt-6-astra`) or `--review-claude [model]` (default `claude-opus-5-5`) and optional `--review-effort <effort>` (default `low`); the selected CLI runs from PATH as the worker user. `adapters/index.js` picks the adapter; `adapters/native.js` holds the process, tool and stop code both share.

## Owners

CI reads current thread resolution via GraphQL and binds only resolved thread and
comment IDs into the review request. The worker omits those comments and replies
from model input. The publisher checks live resolution again; reopened discussion
still needs accounting. No GitHub token is sent to the worker.

Every assessment fetch regenerates the active Markdown and JSON from current
GitHub findings, excluding resolved findings. Any existing Markdown, including
Human notes and selections, is preserved verbatim in
`assessment.md.backup-<timestamp>-<uuid>` rather than merged into the new file.

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
| Publication policy, private journal, reconciliation and advisory Human labels | `publish.js`, `publication-store.js`, `state.js`, `reconcile.js`, `review-decisions.js` |
| Confirmed resolution status and final cross-workflow approval | `approval.js`, `final-approval.js` |
| Report parsing, diff targets and canonical Human rendering | `review-format.js` |
| Result artifact validation and direct receipt delivery | `handoff.js`, `persist.js` |
| Manifest-bound local lifecycle cleanup | `cleanup.js` |

The service/client/model dependency graph must not reach the CI mutation owner. Shared peer code rejects review frames by default; review connections explicitly opt in. No review flow takes a test lease or changes worker queue semantics.

## Request consumers

`repository` and `pr` select the configured public origin, PR owner and publication target. `head` pins Git preparation, native review and publication. `mergeBase` pins source comparison; `base` is provenance. `attempt`, `run`, `caller` and `mode` bind authenticated delivery, durable replay, CI-only correction and publication. `botRevision`, `skillDigest`, `policyDigest` and `runtime` must match the deployed service. `operations` and `readScope` limit review intent/tools and participate in the effective identity. The protocol rejects additional fields, including removed prior-state hints, arbitrary prompts, credentials, commands, URLs and paths.

The service policy digest binds the checked-in review limits. Repository identity is bound separately in every request. Specification generators are excluded; the final approval gate requires the ordinary specification CI job to succeed.

Source evidence retains raw response revision hashes and semantic context hashes. Only PR target-base SHA is removed from the latter. Evidence includes actual request/page/byte counts, configured limits, zero cache hits when no cache is used, pagination links, loaded-content availability and phase durations. A source marked unknown or an unfetched next page cannot support complete coverage. Evidence identity uses the latest observed revision per URL; it is not an atomic GitHub snapshot.

Native session state and the publication journal belong to the PR owner on the worker and may contain unpublished work. CI checkpoints publication through authenticated service calls; GitHub contains only findings and small identity markers. Receipts and current GitHub observations establish which actions succeeded. Neither native memory nor a request hint proves publication. Startup quarantines unfinished native ownership instead of assuming a crashed child stopped. CI receives result/report/publication data, never native archives.

## Vendored maintenance boundary

`skill/provenance.json` records the coding-skills source commit, copied-file hashes and the original manual publisher hash. The bundled PR review skill, inherited implementation-review lenses, example, prose rules/evaluation and publishing contract remain independently maintained here. Automation overrides repository execution/test/publishing instructions and paths. The CommonJS parser/diff and CI preflight/batch owners are ports from the manual ESM publisher; this is necessary duplication across independent repositories. The sibling manual publisher and Studio extension are unchanged.

Root dependencies are reused: Node 22.12.0, Mocha, `@hyperswarm/dht` and the existing YAML parser from the root lockfile. There is no nested package or contract-build prerequisite. The detached CommonJS DHT fixture uses the installed library directly. That library rejects positional port zero; the fixture supplies an ephemeral-range preference with library collision fallback and uses the actual bound port. It owns and awaits destruction of every peer/bootstrapper.

Run `yarn review-bot:test --grep '<literal case>'` for a focused check, and `yarn review-bot:test` for all detached logic/integration cases. Explicit live acceptance uses `yarn review-bot:test:e2e`; no missing native/live input counts as a pass. Existing SDK/farm tests keep their own runner and preparation. Review runs independently in `review.yml`; normal CI retains bot regression tests without depending on native review or publication.

## Worker and CI integration

The normal worker owns the pool, peer identity, authentication, authorization store, connection deduplication, heartbeats and shutdown. `--review-codex` or `--review-claude` initializes the review handler below the worker work root and advertises the review topic pair. Authenticated `REVIEW_*` messages are dispatched before test lease handling. `ReviewService.attach` uses the existing protocol peer; it opens no second pool and performs no second authentication.

CI derives a review identity per run attempt by SHA-256 hashing the fixed `peer3/review-orchestrator/v1` domain (NUL terminated), existing orchestrator seed bytes, and JSON array of repository ID, run ID and attempt strings. Every job and reconnect in that attempt derives the same key; different runs do not displace each other's connections. No new secret is required. The deployment uses shared-secret admission with unlisted orchestrators allowed; strict key allowlisting is not required for this setup. Per-PR conversations remain independent of client keys. Discovery uses the review topic pair and capability negotiation. The Codex adapter uses the existing worker user's login with only PATH, HOME and optional CODEX_HOME passed to its process; the Claude adapter passes only PATH, HOME and optional CLAUDE_CONFIG_DIR, never an API key. This is source-tool restriction, not separate OS-user isolation.

Publication uses the publisher job's `GITHUB_TOKEN`, with pull requests write and issues write. Credentials remain step-scoped. The model job remains read-only; result artifacts expire after one day without a cleanup job. Receipt delivery runs directly in the publish job. Enable the repository's Actions approval setting. See [first live run](../../docs/pr-review-bot.md#first-live-run).

Human-decision markers are guidance for people and implementing agents. The reviewer assesses ordinary discussion; the publisher does not authenticate Human replies or query maintainer permissions. No review enablement variable or maintainer list is needed.
# Publication transport lifetime

Publishing executes the completed review's dispositions; journal load/save calls
do not invoke the model. Discovery and each pending journal RPC have a transport
deadline. Time spent executing GitHub operations between those calls does not
consume a model or journal deadline. GitHub freshness checks still run before
existing-finding actions, and CI logs each action's start and completion.
