# PR reviews on the existing worker

Automated model output is ordinary Markdown: finding IDs, status/location lines,
evidence-backed prose and a short completion section. The worker derives editor
metadata, evidence URLs and discussion revision hashes. The model does not emit
hidden JSON snapshots or bookkeeping footers. Legacy saved reports remain readable.
Inline targets are checked before model success, inside the existing session's
format-repair loop. GitHub receives small, independently marked inline batches;
completed batches are retained on retry. Transient reads retry automatically,
and ambiguous publication failures reconcile GitHub markers before retrying writes.
API failures record the operation and HTTP status without exposing credentials.
Permanent permission errors or unavailable GitHub service still need recovery;
they cannot be solved by asking the model to rewrite a valid review.

Start the normal distributed worker with `--review-codex` or `--review-claude` to offer source-only reviews as well as tests:

```sh
yarn test:parallel:server --name worker-one --review-codex
yarn test:parallel:server --name worker-one --review-codex gpt-6-astra --review-effort medium
yarn test:parallel:server --name worker-one --review-claude
yarn test:parallel:server --name worker-one --review-claude claude-opus-5-5 --review-effort high
```

`--review-codex [model]` reviews with Codex (default model `gpt-6-astra`); `--review-claude [model]` reviews with Claude Code (default model `claude-opus-5-5`). A worker offers one provider. `--review-effort <effort>` is passed to the selected CLI as its reasoning effort (default `low`; Claude accepts `low`, `medium`, `high`, `xhigh` and `max`). These are worker settings: change them by restarting the worker, not by pushing. CI accepts either provider and does not check the model or effort.

Both providers get the same skills, instructions, source tools, validation and publication. Only the model behind the review differs. A PR's saved conversation continues only with the provider that created it; after a provider switch the next review starts a new conversation seeded with the saved findings.

Keep your existing worker flags and environment. The worker uses the same identity, `SCP_TEST_POOL_SECRET`, authentication, authorization policy and connection lifecycle. No separate review server, JSON configuration, secret or operating-system user is required. Review clients derive a distinct transport identity as described below. When the worker permits unlisted authenticated orchestrators, the review handler does too. Strict allowlists must authorize that derived review key before the service can be reached.

## Worker prerequisites and storage

Run the worker as the user whose review CLI is installed and logged in. CLI versions are recorded in each result's `runtime` (for example `codex-0.156.1` or `claude-2.1.280`), not enforced; the adapters were last tested with Codex CLI `0.156.1` and Claude Code `2.1.280`.

- **Codex:** `codex` must be on `PATH`. The adapter requests the configured model and effort, fails if Codex does not list that model, and verifies the existing login is a ChatGPT account. The worker passes only `PATH`, `HOME` and optional `CODEX_HOME`.
- **Claude:** `claude` must be on `PATH` and logged in with a claude.ai subscription (`claude auth status` shows `authMethod: claude.ai`). The worker passes only `PATH`, `HOME` and optional `CLAUDE_CONFIG_DIR`, never an API key. Each review runs `claude -p` with its built-in Bash, Read, Edit and Write tools plus the worker source tools (served in-band over the CLI's stream-JSON protocol), and no settings files, skills, plugins or user MCP servers. It runs with `--permission-mode dontAsk --permission-prompts none`, so anything not allowed is denied, never asked about. A session exposing any other tool, or any CLI permission request, stops the review. Claude Code's sandbox needs `bubblewrap` and `socat`; as root it runs in its weaker nested mode, which keeps the file and network rules below. An unknown model fails at the first turn. The adapter raises Claude Code's tool-result caps (`MAX_MCP_OUTPUT_TOKENS` and each tool's `anthropic/maxResultSizeChars`, whose maximum is 500,000 characters), so full GitHub pages reach the model instead of a preview it cannot open. Otherwise Claude re-reads the same pages in tiny requests and can exhaust GitHub's unauthenticated limit of 60 requests per hour.

Missing CLI, unavailable model, expired login or usage exhaustion fails the review. There is no API-key or paid-credit fallback.

Review worktrees, session records and runtime files live under `<worker-work-root>/review/`. With the normal default this is `./temp/distributed-worker/review/`. The worker keeps test-owned paths separate. Native session files remain in the CLI's own home (Codex home, or `~/.claude/projects` for Claude); the registry records the exact native session IDs it owns and which provider owns each. This uses the worker's operating-system identity, not a separate security boundary. The server persists the returned report; direct publication remains disabled.

### Headless sandboxed workspace

Each review gets a workspace under `<worker-work-root>/review/workspaces/<repository>-<pr>/`:

- `source`: the PR checkout at the reviewed head, and its Git history. Read-only.
- `github`: the PR's GitHub data, fetched by the worker before the model starts and written as JSON, one file per page: the pull request, conversation comments, inline comments, reviews, files and commits. Read-only; rebuilt for every review.
- `scratch`: the model's working directory, where it may write notes or helper scripts. Kept per PR and deleted with the PR's other state.

The models run headless and use their own tools (shell, file read and search, `git`) as well as the worker source tools. Everything runs in the CLI's sandbox:

- **Codex** uses a permission profile passed with `-c` (`default_permissions="review"`). Only the listed paths exist inside it: system directories, the Codex and node installs, `source`, its Git directory, `github`, and `scratch`, which is the only writable one. The network is off, commands see only core environment variables, and hosted web search is disabled because it would bypass the sandbox. The worker omits `thread/start`'s `sandbox` field, which would replace the profile, and requires Codex to report the profile as active. It answers the model's requests for user input automatically, saying no human is available.
- **Claude** gets `--settings` with its sandbox on (mandatory, no unsandboxed fallback). The sandbox denies reads of the home directory, the repository and the worker work root, except the workspace folders and the node install, allows writes only to `scratch`, and blocks all network. `WebFetch` and `WebSearch` are denied, and Read/Edit/Write are held to the workspace by permission rules.

Both were checked live on testing11: the models read `source` and `github` and wrote to `scratch`. Writing to `source`, reading the worker's `.env` and the Codex/Claude logins, and reaching the network all failed. The instructions (`skill/references/automation.md`) tell the models the folder layout and that no human will answer.

## Discovery and dispatch

A review client announces the review-orchestrator topic and discovers the review-worker topic. An enabled worker announces its test and review topics and discovers both orchestrator topics. Existing mutual authentication and reciprocal dialing apply, with the same public keys and shared secret. Topics select discovery; the connection itself stays neutral.

The worker advertises the review capability in `SERVER_READY`. The client negotiates `REVIEW_HELLO`/`REVIEW_READY`, then sends bounded request/result/correction/receipt frames. The normal worker dispatcher routes review frames before test lease handling. Review requests do not request a test lease, alter its status or consume a test queue slot. Test messages can still use that connection. Heartbeats remain owned by the normal connection lifecycle, and existing deduplication stays in place. Git fetch, checkout and worktree removal run asynchronously so waiting for Git does not block worker messages.

The current deployment assumes one review-capable worker. Native sessions and publication receipt delivery belong to that worker; there is no replicated session store or failover. Deploy the same bot revision and vendored skill that CI uses. Mismatched revisions fail visibly instead of silently switching review behavior.

Public evidence reads include the assigned PR's timeline and the exact controller-bound head commit's check runs and combined status. CI endpoints require a pinned head; branches and other commits are not permitted. Responses retain revision, status and conclusion, and malformed or mismatched evidence fails closed. Redirects and pagination links use the same repository/PR/commit restrictions and context budget. Empty check collections and pending status are evidence, not proof that CI passed.

Workflow-run listings require exactly one `head_sha` matching that same head; only pagination parameters are allowed alongside it. Returned runs must belong to the assigned repository and head. Other Actions endpoints remain denied.

Tool-local invalid arguments, denied operations, unavailable public evidence and temporary tool concurrency limits return sanitized failed-tool results to the model. They do not grant access or count as evidence. Failed permitted public reads prevent a complete result until successfully retried; unrequested required discussion evidence still prevents completeness. Exhausted budgets, rate limits, identity mismatches, isolation violations and infrastructure failures remain fatal. Native acceptance includes a rejected public read followed by a successful source read in the same turn.

## CLI invocation and skills

`adapters/codex.js` starts `codex app-server` with execution and unrelated tools disabled, then communicates through stdin/stdout. It initializes the app server, checks the account and model, and starts or resumes the PR's native thread.

Native history responses are not subject to a report-size cap: a resumed thread
can contain many rounds of source reads and reports. The adapter decodes UTF-8
across pipe chunks and assembles each JSON frame once. Setup failures preserve
the existing conversation ID; older cleared registry IDs can be recovered from
the last confirmed publication baseline. This does not bypass report validation
or change the CI result-transfer limit.

`server.js` reads the vendored skill files and passes their combined text as `developerInstructions`. This is direct instruction loading, not automatic skill discovery or a slash command. The fixed `skill/references/review-prompt.md` plus controller-bound request JSON is sent through `turn/start`. Invalid output, missing known discussion accounting and invalid inline targets are repaired in the same conversation within the remaining cumulative model budget, rather than failing after one repair. Legacy footer-only repairs remain readable for saved drafts; new output uses plain Markdown. Recovered tool attempts are not unresolved errors. Drafts are retained as `<attempt>-<revision>-draft-<n>.md` before validation. Internal format repairs do not consume CI's discussion-accounting correction, whose output uses the same repair loop. Missing evidence, provider failures and exhausted time still produce honest failures, never a fabricated successful review.

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
`🧑 **HUMAN DECISION REQUIRED**` at the beginning and an explicit question. This is advisory guidance, not a separate resolution gate; an existing specification or Human decision can settle it.

CI uses the existing `SCP_TEST_POOL_SECRET` and `SCP_TEST_ORCHESTRATOR_SEED`. Review derives its seed as SHA-256 of the fixed UTF-8 domain `peer3/review-orchestrator/v1` followed by a NUL byte, original seed bytes, and the JSON array of `GITHUB_REPOSITORY_ID`, `GITHUB_RUN_ID`, and `GITHUB_RUN_ATTEMPT` strings. Those values are required in CI. Reconnects and jobs within one run attempt share a key; concurrent runs have different keys. Test identity and test-lease serialization are unchanged. No new secret is required. The selected deployment policy accepts unlisted clients authenticated with the shared pool secret; a strict public-key allowlist is not part of this per-run setup. Local clients without an environment seed retain their existing persistent identity. Review conversations remain keyed by repository and PR, not client identity.

No review-specific CI variables or secrets are required. Eligible PR pushes request a review automatically; discovery fails visibly if no review worker is available. The worker's `--review-codex` flag controls whether it offers the service and which model it uses. Limits and policy hashing come from the checked-in `config.js`.

Human-decision markers tell people what needs a decision and tell implementing agents to ask their humans. They do not verify identity or repository authority. People can use ordinary PR comments; there is no required reply template or maintainer-ID list. The reviewer assesses the discussion and explains whether the question is settled. The protocol's authority label describes who the question is aimed at; it is not an access check.

The CI publisher uses its job-scoped `GITHUB_TOKEN` with pull requests write and issues write, exposed only to the steps that need it. It posts as `github-actions[bot]`, whose ID is resolved from GitHub. Other workflows share that account; existing custom-App history is not automatically adopted. Model and worker processes receive no publisher token. Neither review job needs Actions write permission.

In Settings → Actions → General → Workflow permissions, enable **Allow GitHub Actions to create and approve pull requests**. Keep default token permissions read-only; the workflow grants the publisher its explicit write scopes. Organization policy may prevent that setting. See [GitHub's documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests). No custom App installation is needed. Existing protections may restrict approval dismissal; live acceptance must verify those permissions.

## First live run

1. Commit the implementation. Update the worker's checkout to the same bot revision used by the PR. Install its normal dependencies.
2. In the worker's normal login environment, check `codex --version` and `codex login status` (ChatGPT login), or `claude --version` and `claude auth status` (claude.ai login).
3. Restart the existing worker command with `--review-codex` or `--review-claude` added (optionally a model and `--review-effort`). Keep its existing name, work root, secret and authorization flags. No second process or configuration file is needed.
4. Enable GitHub Actions approval as described above. Keep the existing CI pool/orchestrator secrets.
5. Push to the existing same-repository implementation PR. A comment alone does not start review. A manual workflow rerun uses its original event head and skips if that head is now stale.
6. Inspect `review-model` and `review-publish` in the separate PR Review Bot workflow. Confirm publication for the latest SHA and the service's confirmed receipt. Fix a finding and push again to exercise continued review and resolution.
7. If a finding needs a Human decision not already settled by the specification or prior discussion, discuss it in an ordinary comment and push again. Verify the assessment against that decision.

Review is independent of ordinary CI. Bot regression tests remain in CI, but no review job gates spec, test or browser jobs. Only the distributed test job uses the shared repository-wide queue; other CI jobs may overlap. Fork and Dependabot review paths remain ineligible. Native review jobs are advisory; do not add them as required checks or change branch protection to make acceptance pass.

Review concurrency is per PR: active work finishes and only the newest pending run is retained. Admission skips a head already superseded before review begins. If the head changes during review, the completed report stays on the server and publication skips it without a failure comment. Acknowledgement releases ownership without advancing the confirmed-publication baseline. The next review resumes that conversation, accounts for current discussion and the latest private findings, and publishes only for the current head.

An equivalent CI rerun joins the ongoing review even during setup or unfinished
evidence gathering. Cancelling the first CI caller does not cancel that review or
force its replacement to queue behind it. Each delivery retains its own attempt
and caller binding. Reuse of an already-completed result still requires matching
effective inputs and fresh evidence; different heads or policies remain separate.

## Review policy and bounds

### Cheaper follow-up reviews

Reasoning defaults to `low`. The model writes ordinary Markdown without hidden
metadata. The deterministic converter builds the local Studio document, derives
evidence links from prose and binds discussion hashes from actual public reads.
It does not ask the model to duplicate prose or bookkeeping as JSON.
The automated prompt loads the full PR skill, inherited implementation-review
skill and example, followed by source-only execution overrides and the output
contract. All substantive audit sections apply; inherited manual commands do not.
The model must not run tests, builds, checkout operations or publication commands.

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

Every fetch generates a fresh assessment from current GitHub findings and thread
resolution state. Resolved findings are excluded, including advisory Human decision
findings. Existing cards, verdicts, selections and local replies are not merged.
Before replacement, any existing assessment (managed or unmanaged) is preserved
verbatim in a timestamp/UUID-suffixed backup beside the file. Recover previous notes
from that backup. Do not edit the file concurrently with fetch.

If a previously excluded thread reopens before publication, the publisher's missing
accounting IDs restore that thread's comments in the worker reader and its saved
finding context in the correction prompt. The same execution and remaining budget
are retained; comment revisions still come from actual public reads. Other resolved
threads remain excluded.

The companion extension needs the per-finding identity update in `coding-skills`.
Cards carry `Finding ID: R1FO1`; APR numbering is only local presentation.
Old URL-only reply receipts cannot prove which item in a grouped review was answered
and are not copied to every finding. Inspect existing replies before reposting.

### General finding resolution

The worker loads the full vendored `review-pr` and `review-implementation` skills
from `coding-skills/luka/codex`, with the source-only automation overrides. Follow-up
reviews reuse evidenced audit dispositions, not merely the prior publication:
missing lens and behavior-to-test inventories must be completed across the PR.
There is no finding-count cap. Clean sections and certainty percentages stay omitted.

GitHub finding bodies omit Studio's `Inline comment`/`Target` routing labels.
Unresolved design choices start with `🧑 **HUMAN DECISION REQUIRED**` and one
controller-rendered STOP warning. Technical fixes and choices already settled by
the specification or an explicit Human decision do not require another decision.

New general findings are separate section-labelled comments. Confirmed fixes or
disagreements collapse the original finding under `✅ RESOLVED — [ID]`, strike
through its prior text and retain the resolution explanation. Older grouped review
bodies are edited only within the matching finding's controller-owned boundaries;
sibling findings stay visible. Recurrence restores the finding in place. Ambiguous
ownership/boundaries fail closed. Human-decision labels are advisory and follow the
same evidence-based reassessment and resolution rules as other findings.

The reviewer inspects source and current discussion and decides which findings
remain and which are resolved. That includes third-party threads: evidence from
code and replies is sufficient; no special consent gate applies. The publisher
resolves such a thread only when all its current substantive replies have settled,
revision-bound decisions. General comments are retained, with their dispositions
and linked findings recorded privately on the server.

Both `ci.yml` and `review.yml` end with an `approve` job using the same
deterministic gate. This works on PR branches without a workflow on `master`.
The first finisher defers if the other workflow is still running. The last
finisher checks successful substantive jobs in both workflows, ignoring the
approval jobs themselves. A partial rerun relabels retained jobs with the new attempt
number, so the gate takes the model's producing attempt from the newest
unexpired `review-<run>-<attempt>-result` artifact. A shared per-PR concurrency group prevents duplicate
approval writes. The gate reads the server's confirmed publication receipt and
`everythingResolved` state, then rechecks current GitHub discussion and head.
New or edited discussion, an open thread, an open finding, incomplete publication,
or unsuccessful CI prevents approval. It never calls the model. Approval has a
metadata-only body; the bot never merges. A comment alone starts no run, so new
discussion requires another review before approval.

Defaults are sixty minutes cumulative model time, fifteen minutes validation hold, fifteen minutes queue wait, five minutes setup, sixty seconds per transfer, ten seconds termination, and sixty seconds cleanup context. The service allows four concurrent PR owners and sixteen pending requests. Review retrieval has no cumulative request, page or byte cap; zero in those configured limits means unlimited. Counters remain recorded. Progress and reconnect do not reset the model timeout. Missing evidence prevents approval.

### GitHub read token

Without a token the worker's GitHub reads share the anonymous limit of 60 requests per hour per IP. Set `SCP_REVIEW_GITHUB_TOKEN` in the worker's `.env` to a fine-grained personal access token with **Public repositories (read-only)** access and no other permissions; the limit becomes 5,000 requests per hour. The worker sends it only to `api.github.com`, never to the model processes, and never logs it. Restart the worker after changing it.

Each API page is remembered with its ETag and re-read with `If-None-Match`. An unchanged page returns `304` and is served from memory; with the token GitHub does not charge a `304` against the limit, so freshness checks and repeated reads of unchanged pages cost nothing. The worker keeps up to 64 MB of pages, oldest evicted first.

A valid future GitHub throttle reset is respected. Missing, invalid or expired reset information uses the configured context window; the affected origin becomes usable again after expiry. `review-public-throttle` records count, origin, status, reason and `blockedUntil` without credentials.

## Cleanup and failures

Initial and resumed reviews receive the current controller-owned policy bundle.
Internal format and accounting corrections reuse that conversation's loaded policy
and receive focused repair instructions rather than another full review task.
Both initial reviews and corrections emit progress. Repository content cannot
replace the controller policy.

Source-review completion is separate from runtime verification. Missing live
acceptance or CI evidence goes in `coverage.verificationMissing`: findings remain
publishable; the final gate relies on actual CI results, not model verification
claims or recommendations. Passive limitations stay in metadata, not
public status comments. Concrete coverage defects use ordinary stable finding IDs.
Publication state is persisted privately by the worker in its per-PR publication
journal beside the saved reports and conversation records. Authenticated CI reads
and checkpoints its active projection; compare-and-swap rejects stale updates. Full
older reports remain on the worker, while older journal entries sent to CI contain
only identity/origin records, not historical finding bodies. GitHub stores
only finding text and small finding/action identity markers, never report snapshots.
Publication retries reuse the saved result and reconcile those markers before writes,
including after HTTP 500 or a lost mutation response. Pending analysis is compared
with observed public content: an absent open finding is created, an unapplied update
is applied, and a never-posted closed finding stays private.
Completed-result replay returns its saved receipt without repeating writes. A new
review execution on the same head gets a new publication round, reconciles current
discussion, and saves its own findings, approval evidence and receipt. Historical
receipt identities remain available without transferring historical report bodies.
Omitted findings whose threads are already resolved remain history with their
original source dispositions; omission cannot reopen them or fabricate a fixed
assessment. The approval evidence excludes that resolved history from the active
finding set. Explicit current reassessment can reopen a recurrence, and the final
gate still checks current GitHub thread state before approving.
Clean rounds do not create placeholder comments; failures use a deduplicated error
notice. Historical snapshots are imported into the journal on first publication;
edited finding bodies lose their legacy snapshots. Untouched historical comments
are not bulk-edited. Public model reads strip those snapshots and retain only compact
finding identities/revisions. Assessment fetching reads marked GitHub findings and
resolved thread state without needing access to the worker journal.
Human-decision findings display `🧑 HUMAN DECISION REQUIRED` and a STOP warning:
this applies to unresolved design choices, not purely technical fixes or choices
already settled by the specification or an explicit human decision. Cite the
settling authority and proceed without requesting the same decision again. For
unresolved choices,
implementing agents must ask their human before choosing. The label is advisory,
not an extra publication or resolution gate. The reviewer can resolve it when code,
specification or discussion evidence establishes it is addressed, without requiring
a separate Human reply or consent record.
Unread source/discussion still goes in `coverage.missing` and fails the round.
The controller never reclassifies old incomplete reports by guessing from prose.

Unknown GitHub thread-resolution flags do not make source coverage incomplete.
The agent records them in `coverage.verificationMissing` and returns its finished
review with recommendation comment. Public reads explicitly label thread status
unknown; the Files browser URL maps to the paginated files API rather than HTML
scraping. Source, comments, replies and pagination must still be inspected in full.
The publisher retains its independent current-thread checks before resolution or
reopening. Unknown flags never imply a fixed defect or human consent.

Review context reads have no separate elapsed-time deadline. The overall model
budget remains one hour, with a 30-second timeout per public HTTP request.
GitHub rate-limit backoff remains enforced. Explicit nonzero retrieval limits are
still supported for bounded maintenance or diagnostic callers; reviews default
to unlimited retrieval. Source search scans every line in permitted tracked files
and returns all matches rather than aborting at 500 lines or 200 matches. Cleanup
retains its separate maintenance deadline. Legacy `elapsedMs` evidence is accepted
when reading old results but is no longer emitted as a review context limit.

Worker shutdown stops native review processes, closes sessions and releases review resources before closing its pool. Review-enabled graceful shutdown awaits that cleanup; a second interrupt can still force exit. An interrupted registry is quarantined until process termination is established. Do not delete locks as a substitute for stopping an active process.

The native adapter explicitly enables `code_mode_host`: the model uses that gateway to call the constrained source tools. Shell execution, unified exec, browsers, apps and other unrestricted tools remain disabled. Disabling the gateway prevents even permitted source reads. Native shutdown waits within the termination budget for the entire process group to disappear, not just its leader. Cleanup failure keeps the PR quarantined but does not replace the original review error delivered to CI.

After changing native tool configuration, run the live `pinned native adapter acceptance` case that reads tracked source through Code Mode, as well as the detached tests. A model-only timeout probe does not establish that tool dispatch works.

Daily cleanup reads registered worktree manifests, queries GitHub, and rechecks a positive closed/merged state while holding PR ownership. Missing, denied or ambiguous observations preserve data. It deletes only registered native session IDs and owned worktree/report/attempt records. To run the same cleanup manually, stop the worker and use `yarn review-bot:cleanup /absolute/path/to/worker-work-root`.

CI retains the model handoff artifact for one day and relies on GitHub expiration; there is no immediate artifact-deletion job. Ordinary test logs retain their own retention policy. Publication delivers its receipt directly to the worker in the same job, without another checkout or receipt artifact. Publication is not rolled back if receipt delivery fails: the private journal and durable generated result allow a publish-job retry to recover the confirmed round without another model execution or duplicate comments. Late receipts remain bound to their original attempt/execution and cannot roll back a newer confirmed baseline.

A failed model/review remains a failed native CI job. Inspect its sanitized error, worker logs and job summary. `LOGIN_EXPIRED` requires restoring the worker user's login; `SUBSCRIPTION_LIMIT` requires waiting for included usage; `MODEL_UNAVAILABLE` requires the supported CLI/model; context errors require inspecting the missing public evidence. Do not add credential or paid-route fallbacks to hide failures.

An explicit incomplete review triggers continuation in the same conversation,
with its missing surfaces and evidence errors returned to the agent. The worker
keeps the draft and asks the agent to finish the remaining source review within
the existing cumulative model budget; it does not accept an incomplete result or
publish its findings. Controller-confirmed resolved threads are deliberately out
of scope, and unavailable runtime tests belong under verification limitations,
not missing source coverage. Provider/infrastructure failure or budget exhaustion
can still terminate the attempt without fabricating completion. Previously acknowledged
incomplete reports do not qualify as incremental review baselines. PR browser-root
URLs are read through the corresponding public REST PR endpoint, not GitHub's
changing HTML shell; the discussion collections must still be read separately.

## Verification boundaries

`yarn review-bot:test` exercises real local Git, filesystem, process, DHT and worker dispatch owners plus recorded GitHub boundaries. It does not prove a live model review or GitHub permissions. The temporary acceptance observer is no longer a CI gate; inspect live publication and receipt outcomes separately.

For an explicit native lifecycle probe on the worker, use `REVIEW_NATIVE_ACCEPTANCE=1 REVIEW_WORK_ROOT=/absolute/worker-root REVIEW_NATIVE_WORKTREE=/absolute/source-fixture REVIEW_NATIVE_REPORT_DIR=/absolute/report-fixture yarn review-bot:test:e2e --grep 'pinned native adapter acceptance'`. Use fixture paths and run while the normal worker is stopped. This consumes a real model turn; missing inputs fail rather than count as success. Full review, Human interaction, resume, publication and lifecycle coverage still need observed live evidence.
