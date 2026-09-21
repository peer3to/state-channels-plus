# PR reviews on the existing worker

Start the normal distributed worker with `--review` to offer source-only Codex reviews as well as tests:

```sh
yarn test:parallel:server --name worker-one --review
```

Keep your existing worker flags and environment. The worker uses the same identity, `SCP_TEST_POOL_SECRET`, authentication, authorization policy and connection lifecycle. No separate review server, JSON configuration, identity, allowlist or operating-system user is required. When the worker permits unlisted authenticated orchestrators, the review handler does too. When the worker requires its existing allowlist, that rule applies before either service is reached.

## Worker prerequisites and storage

Run the worker as the user whose Codex CLI is installed and logged in. `codex` must be on `PATH`; the current adapter checks CLI version `0.154.0`, requests `gpt-6-astra` with `low`, and verifies the existing login is a ChatGPT account. Missing CLI, unsupported version/model, expired login or usage exhaustion fails the review. There is no API-key or paid-credit fallback. The worker uses the existing `HOME` and optional `CODEX_HOME` for that login.

Review worktrees, session records and runtime files live under `<worker-work-root>/review/`. With the normal default this is `./temp/distributed-worker/review/`. The worker keeps test-owned paths separate. Native Codex session files remain in the existing Codex home; the registry records the exact native session IDs it owns. This uses the worker's operating-system identity, not a separate security boundary. Model execution still receives only the approved source/public-read tools and report output tool; application execution, tests and direct publication remain disabled.

## Discovery and dispatch

A review client announces the review-orchestrator topic and discovers the review-worker topic. An enabled worker announces its test and review topics and discovers both orchestrator topics. Existing mutual authentication and reciprocal dialing apply, with the same public keys and shared secret. Topics select discovery; the connection itself stays neutral.

The worker advertises the review capability in `SERVER_READY`. The client negotiates `REVIEW_HELLO`/`REVIEW_READY`, then sends bounded request/result/correction/receipt frames. The normal worker dispatcher routes review frames before test lease handling. Review requests do not request a test lease, alter its status or consume a test queue slot. Test messages can still use that connection. Heartbeats remain owned by the normal connection lifecycle, and existing deduplication stays in place. Git fetch, checkout and worktree removal run asynchronously so waiting for Git does not block worker messages.

The current deployment assumes one review-capable worker. Native sessions and publication receipt delivery belong to that worker; there is no replicated session store or failover. Deploy the same bot revision and vendored skill that CI uses. Mismatched revisions fail visibly instead of silently switching review behavior.

Public evidence reads include the assigned PR's timeline and the exact controller-bound head commit's check runs and combined status. CI endpoints require a pinned head; branches and other commits are not permitted. Responses retain revision, status and conclusion, and malformed or mismatched evidence fails closed. Redirects and pagination links use the same repository/PR/commit restrictions and context budget. Empty check collections and pending status are evidence, not proof that CI passed.

Workflow-run listings require exactly one `head_sha` matching that same head; only pagination parameters are allowed alongside it. Returned runs must belong to the assigned repository and head. Other Actions endpoints remain denied.

Tool-local invalid arguments, denied operations, unavailable public evidence and temporary tool concurrency limits return sanitized failed-tool results to the model. They do not grant access or count as evidence. Failed permitted public reads prevent a complete result until successfully retried; unrequested required discussion evidence still prevents completeness. Exhausted budgets, rate limits, identity mismatches, isolation violations and infrastructure failures remain fatal. Native acceptance includes a rejected public read followed by a successful source read in the same turn.

## CLI invocation and skills

`adapters/codex.js` starts `codex app-server` with execution and unrelated tools disabled, then communicates through stdin/stdout. It initializes the app server, checks the account and model, and starts or resumes the PR's native thread.

`server.js` reads the vendored skill files and passes their combined text as `developerInstructions`. This is direct instruction loading, not automatic skill discovery or a slash command. The fixed `skill/references/review-prompt.md` plus controller-bound request JSON is sent through `turn/start`. A single fixed correction prompt may name invalid schema identifiers or missing discussion-accounting IDs. Initial and corrective turns share the model budget.

## CI setup

Reviews use `low` reasoning and a one-hour cumulative model budget, shared with
correction turns. Review-model and review-publish jobs each allow 110 minutes for
their surrounding setup, transport and validation work. The model receives time
guidance; the controller enforces the limit independently.

Only actionable findings and unresolved human decisions are published. Findings
explain the triggering path, impact, proposed fix and verification, without certainty
percentages or green no-change cards. General findings retain their report section
headings. Findings with valid pinned-diff locations publish inline; a source hyperlink
alone does not create an inline comment. Human decisions carry
`🙋 **Human assessment needed**` and an explicit question.

CI uses the existing `SCP_TEST_POOL_SECRET` and `SCP_TEST_ORCHESTRATOR_SEED`. Local clients use the normal `temp/distributed-orchestrator` identity when no seed environment value is supplied. Review does not derive or provision a different key.

No review-specific CI variables or secrets are required. Eligible PR pushes request a review automatically; discovery fails visibly if no review worker is available. The worker's `--review` flag controls whether it offers the service. Limits and policy hashing come from the checked-in `config.js`.

Human-decision markers tell people what needs a decision and tell implementing agents to ask their humans. They do not verify identity or repository authority. People can use ordinary PR comments; there is no required reply template or maintainer-ID list. The reviewer assesses the discussion and explains whether the question is settled. The protocol's authority label describes who the question is aimed at; it is not an access check.

The CI publisher uses its job-scoped `GITHUB_TOKEN` with pull requests write and issues write. It posts as `github-actions[bot]`, whose ID is resolved from GitHub. Other workflows share that account; existing custom-App history is not automatically adopted. Model and worker processes receive no publisher token. Cleanup alone has Actions write and deletes only recorded handoff artifacts from its own run/attempt.

In Settings → Actions → General → Workflow permissions, enable **Allow GitHub Actions to create and approve pull requests**. Keep default token permissions read-only; the workflow grants the publisher its explicit write scopes. Organization policy may prevent that setting. See [GitHub's documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests). No custom App installation is needed. Existing protections may restrict approval dismissal; live acceptance must verify those permissions.

## First live run

1. Commit the implementation. Update the worker's checkout to the same bot revision used by the PR. Install its normal dependencies.
2. In the worker's normal login environment, check `codex --version` and `codex login status`. The adapter currently expects `codex-cli 0.154.0` and ChatGPT login with Astra access.
3. Restart the existing worker command with `--review` added. Keep its existing name, work root, secret and authorization flags. No second process or configuration file is needed.
4. Enable GitHub Actions approval as described above. Keep the existing CI pool/orchestrator secrets.
5. Push to the existing same-repository implementation PR. A comment alone does not start review. A manual workflow rerun uses its original event head and skips if that head is now stale.
6. Inspect `head-check`, `review-bot-tests`, `review-model`, `review-publish`, `review-persist`, `review-cleanup` and `review-bot-observer`. Confirm a review for the correct SHA, the service's confirmed receipt, and deletion of the result/receipt artifacts. Fix a finding and push again to exercise continued review and resolution.
7. If a finding needs a Human decision, discuss the decision in an ordinary comment and push again. Verify agent assessment before resolution. Keep the temporary acceptance jobs enabled until Luka explicitly accepts the feature.

While temporary acceptance is enabled, the observer blocks ordinary CI if review fails. The whole-repository queue remains unchanged. Fork and Dependabot review paths remain ineligible. Native review jobs are advisory; do not add them as required checks or change branch protection to make acceptance pass.

## Review policy and bounds

### Cheaper follow-up reviews

Reasoning defaults to `low`. The model writes one Studio Markdown report; the
deterministic converter derives finding bodies and combines them with compact
bookkeeping metadata. It does not ask the model to duplicate prose as JSON.
The automated prompt loads only source-review guidance and the output contract,
not the manual checkout/test/publication workflow or example reports.

The worker resumes the existing PR chat. A confirmed complete publication receipt
records the reviewed head and merge-base. On the next round, that baseline is used
only in the same session, with matching merge-base and verified ancestry. The
controller supplies changed filenames; `source_diff` includes the delta plus the
full PR diff for valid inline anchors. Failed attempts never advance this baseline.
Missing/rewritten ancestry or a changed merge-base falls back to the full review.
Current discussion and outstanding Human decisions are still checked every round.

Progress logs distinguish connectivity from native events: phase, completed-item
count, tool-call count and age of the last model event. A heartbeat is not proof
that the model is working. No reasoning text or credentials are logged. Transport
reconnects retain the execution and never extend its deadline.

### Fetch an assessment locally

Authenticate GitHub CLI once with `gh auth login`, or supply `GH_TOKEN`/
`GITHUB_TOKEN` with repository read access. The script prefers these environment
variables, then tries `gh auth token`, falling back to `gh config get oauth_token`
for older GitHub CLI versions. Both commands target `github.com`; tokens are never
printed. Then run from this repository:

```sh
yarn review-bot:fetch-assessment 498
# Or supply the PR URL (or a number with --repo owner/repo):
yarn review-bot:fetch-assessment https://github.com/peer3to/state-channels-plus/pull/498
```

The script reads GitHub only and writes
`temp/pr-github-reviews/498/assessment.md` plus a `github-findings.json` snapshot.
It imports outstanding bot findings, not an AI assessment: Assessment, Reply and
Proposed fix start empty for you to fill. It supports old grouped reviews and
new individual comments using the published finding ID and source URL. Open the
Markdown file in **PR Review Studio** assessment mode. Edit the assessment and
implementation plan locally; use the extension's explicit preview/reply action
when ready to publish. Fetching never posts, resolves or invents a Human answer.

Rerunning the command preserves existing cards and all local assessment/reply/fix
text. Resolved cards already in your file are marked resolved rather than removed;
newly imported cards exclude addressed/resolved findings. Required unanswered Human
decisions remain visible even if someone manually resolved their thread. Changed
remote findings are flagged for rechecking; local original text stays intact. A
refresh creates a timestamped backup before replacing a changed assessment. An
unmanaged existing assessment is refused rather than overwritten; move it aside
yourself or keep using it separately. Do not edit the file concurrently with fetch.

The companion extension needs the per-finding identity update in `coding-skills`.
Cards carry `Finding ID: R1FO1`; APR numbering is only local presentation.
Old URL-only reply receipts cannot prove which item in a grouped review was answered
and are not copied to every finding. Inspect existing replies before reposting.

### General finding resolution

New general findings are separate section-labelled comments. Confirmed fixes or
disagreements collapse the original finding under `✅ RESOLVED — [ID]`, strike
through its prior text and retain the resolution explanation. Older grouped review
bodies are edited only within the matching finding's controller-owned boundaries;
sibling findings stay visible. Recurrence restores the finding in place. Ambiguous
ownership/boundaries fail closed. Required Human decisions still require actual
discussion and the reviewer's assessment before resolution.

The reviewer inspects source and current discussion, accounts for existing findings and Human decisions, and returns structured output. CI validates it and owns comments, thread resolution, receipts and advisory approval. The bot never merges. Approval says `Human review still required`; it requires complete evidence and resolved findings/decisions, not merely green CI. A comment alone starts no run.

Defaults are sixty minutes cumulative model time, fifteen minutes validation hold, fifteen minutes queue wait, five minutes setup, sixty seconds per transfer, ten seconds termination, and sixty seconds cleanup context. The service allows four concurrent PR owners and sixteen pending requests. Public context is bounded to forty requests/pages, eight MiB and five minutes per execution. Progress and reconnect do not reset budgets. Missing evidence prevents approval.

A valid future GitHub throttle reset is respected. Missing, invalid or expired reset information uses the configured context window; the affected origin becomes usable again after expiry. `review-public-throttle` records count, origin, status, reason and `blockedUntil` without credentials.

## Cleanup and failures

Worker shutdown stops native review processes, closes sessions and releases review resources before closing its pool. Review-enabled graceful shutdown awaits that cleanup; a second interrupt can still force exit. An interrupted registry is quarantined until process termination is established. Do not delete locks as a substitute for stopping an active process.

The native adapter explicitly enables `code_mode_host`: the model uses that gateway to call the constrained source tools. Shell execution, unified exec, browsers, apps and other unrestricted tools remain disabled. Disabling the gateway prevents even permitted source reads. Native shutdown waits within the termination budget for the entire process group to disappear, not just its leader. Cleanup failure keeps the PR quarantined but does not replace the original review error delivered to CI.

After changing native tool configuration, run the live `pinned native adapter acceptance` case that reads tracked source through Code Mode, as well as the detached tests. A model-only timeout probe does not establish that tool dispatch works.

Daily cleanup reads registered worktree manifests, queries GitHub, and rechecks a positive closed/merged state while holding PR ownership. Missing, denied or ambiguous observations preserve data. It deletes only registered native session IDs and owned worktree/report/attempt records. To run the same cleanup manually, stop the worker and use `yarn review-bot:cleanup /absolute/path/to/worker-work-root`.

CI artifact cleanup waits for its consumers and deletes only recorded run/attempt artifacts; ordinary test logs remain. External interruption can leave deletion unconfirmed. Publication is not rolled back if receipt delivery fails.

A failed model/review remains a failed native CI job. Inspect its sanitized error, worker logs and job summary. `LOGIN_EXPIRED` requires restoring the worker user's login; `SUBSCRIPTION_LIMIT` requires waiting for included usage; `MODEL_UNAVAILABLE` requires the supported CLI/model; context errors require inspecting the missing public evidence. Do not add credential or paid-route fallbacks to hide failures.

## Verification boundaries

`yarn review-bot:test` exercises real local Git, filesystem, process, DHT and worker dispatch owners plus recorded GitHub boundaries. It does not prove a live model review or GitHub permissions. The temporary CI observer checks the actual implementation PR's producers and artifact deletion.

For an explicit native lifecycle probe on the worker, use `REVIEW_NATIVE_ACCEPTANCE=1 REVIEW_WORK_ROOT=/absolute/worker-root REVIEW_NATIVE_WORKTREE=/absolute/source-fixture REVIEW_NATIVE_REPORT_DIR=/absolute/report-fixture yarn review-bot:test:e2e --grep 'pinned native adapter acceptance'`. Use fixture paths and run while the normal worker is stopped. This consumes a real model turn; missing inputs fail rather than count as success. Full review, Human interaction, resume, publication and lifecycle coverage still need observed live evidence.
