---
name: review-pr
description: Luka's private convention for reviewing GitHub PRs in state-channels-plus, peer3-poker-web, and poker-contracts. Use whenever he says "review this PR", "review the PR", "review my PR", "review the open PR", supplies a GitHub PR URL/owner#number, or invokes /review-pr without pointing at a plan or implementation doc. Fetches the exact PR ref and real remote head branch, checks out an extension-ready local branch that tracks the GitHub head, force-aligns divergent review branches, reconstructs the comment/commit timeline, verifies one PR at a time with no overlapping test runs, and writes a blunt, code-grounded, severity-tagged review under temp/pr-github-reviews/{pr_number}/N-review.md.
---

# PR review (private — Luka's workflow)

## Reasoning effort

Use extra-high reasoning effort by default for every review. Override this only when the user explicitly
requests a different reasoning-effort level for the current review.

This skill is `/review-implementation` **plus** PR identification and verified test evidence. Everything about
_what to look for_ and _how to write the file_ comes from `/review-implementation` — do not restate or
re-derive it here. This document only covers the five things that differ: finding the right PR, choosing the
diff range, reconstructing the comment/commit timeline, verifying CI or local gate evidence, and
reporting the results honestly.

**Read `inherited/review-implementation/SKILL.md` and `inherited/review-implementation/example-review.md` before writing anything.** Its rules
apply in full: every lens, every section — including **♻️ Code reuse** — the severity dots, the `[ID]` +
`Fix ID-FIX` callout shape, one finding per bullet, and a concrete line link on every code reference.
`/review-implementation` wins on review content and base formatting. Step 6's selectable wrapper, publishing
metadata, Human block, PR introduction, Specification changes section, comment timeline, and publishing
footer are the PR-specific format additions. Step 4 governs test execution and CI reuse, including when
inherited review instructions call for tests.

This includes the mandatory **📐 Plan Adherence** section when the PR claims an implementation plan, the
mandatory **⚖️ Contradictions** section, and the mandatory **🧼 Dead Code/Cleanup** section on every PR. If no
implementation plan applies, omit Plan Adherence; never omit Contradictions or Dead Code/Cleanup. For
Contradictions, cross-check the specification, implementation reports, verification reports, and actual
source/tests exactly as `/review-implementation` requires. Trace live callers before labeling code unused or
over-engineered.

## Evidence and human assessment

For selectable Studio reviews, put `**Human assessment needed**` inside the existing AI marker block,
next to the finding lead, and put the confidence percentage and the `Decision:` sentence inside that same AI
block (`🟠 **[FO1] 90% — Lead.** **Human assessment needed** Decision: …`). Never alter the card heading
`- [ ] **[ID] Inline comment**` / `General PR comment`: the Studio parser matches it literally and reads the
severity, percentage, and marker from the AI block. Keep the wrapper, JSON metadata, Human block, IDs, and
publishing schema unchanged.
The marker must remain in the published wording so an open question never becomes an asserted defect.
On a new finding leave selection unchecked; preserve the user's existing selection on later reviews.
In the comment timeline, use `Human assessment needed` when evidence cannot support a definitive status;
state the exact missing decision or evidence instead of guessing addressed, disputed, or not addressed.

Keep certainty separate from severity. Use a confirmed conclusion when code, tests, the specification, or
other authoritative evidence clearly establishes it; routine verified facts do not require absolute certainty.
Do not present a plausible failure, an unstated design preference, or a missing oracle as a proved defect.

**Confidence percentage on every finding.** Immediately after the ID, write how certain you are that the
finding is real and correctly characterised: an integer percent in steps of 5, then an em-dash, then the
lead — `🟠 **[FO1] 90% — Finding.**`. Calibrate it against what you actually did in this review: 90–100 only
when you verified it directly (read the exact code path, ran the command, reproduced the behaviour, or
quoted the conflicting text); 70–85 when inferred from the diff and its callers without executing or
reproducing; 50–65 when plausible but unverified, and then say what would confirm it. Never omit the number
and never move it to justify a severity: severity says how much it matters, the percentage says how sure
you are. Green summaries carry a percentage too.

**Mark every finding that needs an explicit human decision.** When the resolution depends on intent,
policy, or a trade-off only the engineer can settle, or when evidence cannot settle the claim, write the
exact marker `**Human assessment needed**` right after the closing `**` of the bold lead (never inside the
bold, which nests markup), and then one sentence starting
`Decision:` that states the question the human must answer. On such a finding the percentage measures
confidence in the evidence, not in the recommended answer. A confirmed finding that needs no decision must
not carry the marker, so the marker alone is the list of things a human has to decide.

When evidence cannot settle a substantive claim with high confidence, or an engineer must choose intent,
write the exact marker `**Human assessment needed**` in that finding's body immediately after its lead.
Keep its existing finding ID, severity, section, links, and `Fix <ID>-FIX` callout. State the evidence and its
limits, the precise uncertainty or decision, a recommended direction with reasons, and the check or decision
that would settle it. Make any proposed fix conditional on that decision. Mark verified conclusions
`**Confirmed**` when needed to distinguish them from open claims in the same discussion. Do not apply
merit/no-merit verdicts to ordinary findings.

After the Bottom line, add a compact **Human assessment needed** priority list, one line per item in the
form `[ID] NN% — the Decision sentence`, linking the stable finding IDs, before the regular lens sections. The
Bottom line states how many findings carry the marker. Omit it when no such items exist.
Within each lens section, put human-needed items first, then preserve severity order and stable order for ties.
Keep the full finding in its normal section; the priority list is an index, not a duplicate assessment. Include
these IDs in the final response. A potential severe impact remains conditional; do not count it as a proved
blocking defect. Genuine decision items must not be dropped by rules that suppress green praise.

Keep all existing completeness and evidence checks. Human-needed marking records unresolved intent or
uncertainty; it is not permission to skip available investigation or to label an incomplete review complete.

## Full-review completion gate

The inherited `/review-implementation` completion gate applies without exception. Review every changed file and
every substantive PR comment or thread, reconcile the full remote file list with the local diff, and complete every
applicable review lens. Do not sample files or comments, stop after headline findings, or treat a passing full test
gate as proof that the review is complete. If any PR ref, file, comment page, plan item, lens, or required check cannot
be inspected, mark `Review coverage: INCOMPLETE`, list each missing surface and why, and do not approve the PR.

## Step 1 — Identify and check out the PR. Never review a URL from a detached worktree.

### A GitHub PR URL or `owner/repo#number` was supplied

Process supplied PRs **in the user's order, one at a time**. Finish identification, checkout, diff review,
verification, and the review file for PR A before fetching/checking out or running any command for PR B.

1. Parse the owner, repo, and PR number. Fetch the PR metadata first (`gh pr view` or the REST API) and record
   `head.ref`, `head.sha`, `head.repo`, `base.ref`, and `base.sha`.
2. Confirm the current repository's `origin` is the requested repository. Fetch the immutable PR ref and base:

    ```sh
    git fetch origin "refs/pull/<number>/head:refs/remotes/origin/pr-<number>-head"
    git fetch origin "<base-ref>"
    ```

3. Fetch the PR's **real remote head branch** too. The immutable PR ref proves the reviewed SHA; the real
   remote-tracking branch and upstream make VS Code's GitHub Pull Requests extension recognize the checkout.
   Do not stop after fetching only `refs/pull/<number>/head`.

    - When `head.repo` is the requested `owner/repo`, use `origin`.
    - For a fork PR, reuse a remote whose normalized URL matches `head.repo`. If none exists, add the narrowly
      named remote `pr-<number>-head` at `https://github.com/<head.repo>.git`; do not repoint an existing remote.
    - Fetch the branch into that remote's tracking namespace:

        ```sh
        git fetch "<head-remote>" \
          "+refs/heads/<head-ref>:refs/remotes/<head-remote>/<head-ref>"
        ```

    - Verify both `refs/remotes/origin/pr-<number>-head` and
      `refs/remotes/<head-remote>/<head-ref>` resolve to `head.sha`. Stop on any mismatch.

4. The local review branch must have the **same name as `head.ref`** and track the real remote branch:
    - If it does not exist, create it from the real remote-tracking branch:
      `git switch -c "<head-ref>" --track "<head-remote>/<head-ref>"`.
    - If it exists, force-align that branch ref to the fetched PR head, even when the histories diverged or
      local commits will become unreachable from the branch. This review branch must reproduce GitHub, not
      preserve a different local history. If the target branch is currently checked out, detach at its current
      commit first; then run
      `git branch -f "<head-ref>" "refs/remotes/<head-remote>/<head-ref>"`,
      `git switch "<head-ref>"`, and
      `git branch --set-upstream-to="<head-remote>/<head-ref>" "<head-ref>"`.
    - Do not merge, rebase, or use `git pull`: the branch ref must equal the fetched `head.sha` exactly.
    - Preserve the working tree and index. Never use `git reset --hard`, `git clean`, or `git stash` merely to
      perform a review. If switching would overwrite dirty tracked or untracked changes, stop before changing
      the branch ref and report the conflicting paths.
5. Verify all three facts before reviewing:
    - `git branch --show-current == head.ref`;
    - `git rev-parse HEAD == head.sha`;
    - `git rev-parse --abbrev-ref --symbolic-full-name @{u} == <head-remote>/<head-ref>` and
      `git rev-parse @{u} == head.sha`.

Use the actual local branch for the review and tests. Do not substitute a detached PR-ref worktree, a
temporary branch with a different name, or a symlinked dependency tree when the requested branch can be
checked out normally.

### No PR URL or number was supplied

**Run `git branch --show-current` yourself, every time.** Do not trust a branch name from the session's
opening context, from AGENTS.md or CLAUDE.md, from earlier in the conversation, or from your own previous
message — the branch changes mid-session (a fix branch gets cut, a worktree gets switched) and a review
written against the wrong PR is worse than no review.

Then find the PR whose **head** is that branch:

```sh
gh pr list --head "$(git branch --show-current)" --state open --json number,title,headRefName,baseRefName,headRefOid
```

If `gh` is not installed or not authenticated, fall back to the REST API — it works unauthenticated on repos
you can read:

```sh
curl -s "https://api.github.com/repos/<owner>/<repo>/pulls?state=open&per_page=100" \
  | jq -r '.[] | "#\(.number) \(.head.ref) -> \(.base.ref) | \(.title)"'
```

Three traps, all of which have bitten this workflow before:

- **A branch can be the head of one PR and the base of another.** Stacked PRs are normal in these repos
  (`398 → 397 → general-test-fixes → dispute`). Review the PR where `head.ref == <current branch>`. If the
  branch is _also_ the base of other open PRs, say so in the meta line — it tells the reader what is stacked
  on top — but do not review those.
- **No open PR for the branch** → stop. Report the branch, the PRs you did find, and ask whether he wants
  `/review-implementation` on the local diff instead. Do not silently review something else.
- **More than one open PR with the same head** → stop and ask which one.

Then compare `headRefOid` against local `git rev-parse HEAD`:

- **Equal** → normal case, say nothing.
- **Local is ahead** → you are reviewing commits the PR does not contain. Check whether those commits belong
  to a _different_ PR (they usually do — that's the stacked case) and state plainly at the top of the review
  which SHA you reviewed and what the PR head is.
- **Local is behind / diverged** → stop and ask before reviewing.

## Step 2 — Establish the diff range

Use the PR's **actual base**, which is frequently not `master`:

```sh
git diff --stat <base>...<head>     # three dots: merge-base, matches GitHub's view
git diff --name-status <base>...<head>
```

Cross-check the file list against the PR's own view (`gh pr diff --name-only`, or the API's `/files`
endpoint). If they disagree, the local base ref is stale — `git fetch` and re-check before continuing.

Read the PR body. The comments get their own step below.

## Step 3 — Build the comment timeline

Comments are **leads, not conclusions** — verify each one in code. Where a comment is already correct, credit
it and mark whether the PR addresses it, rather than re-discovering it as your own finding. Where a fix claims
to resolve a comment, check that it actually closes the hole and not just the reported symptom — a partial fix
that lets the comment be marked resolved is a finding in its own right.

The point of this step is that you can answer three questions about **every** comment on the PR: when was it
written relative to the commits, is it still pointing at live code, and has it actually been dealt with.

### Fetch every source — and don't depend on `gh`

`gh` is frequently not installed on the review machine, and `gh pr view --json comments` returns **only
PR-level discussion** — it silently omits inline comments and review summary bodies. Read all four endpoints.
Use `gh api --paginate <path>` when `gh` exists; otherwise `curl` works unauthenticated on a public repo:

```sh
OWNER_REPO=$(git remote get-url origin | sed -E 's#^(git@[^:]+:|https://[^/]+/)##; s#\.git$##')
API="https://api.github.com/repos/$OWNER_REPO"
curl -s "$API/issues/<n>/comments?per_page=100"   # PR-level discussion
curl -s "$API/pulls/<n>/reviews?per_page=100"     # review submissions: state + summary body
curl -s "$API/pulls/<n>/comments?per_page=100"    # inline comments
curl -s "$API/issues/<n>/timeline?per_page=100"   # commits + reviews + comments, one ordered stream
```

- **Paginate.** Both `gh api` (without `--paginate`) and a bare `curl` stop at 30 items by default. Pass
  `per_page=100`, and follow the `Link: rel="next"` header when a page comes back full.
- Join inline comments to their review submission on `pull_request_review_id`; a `CHANGES_REQUESTED` review's
  summary body is context for every inline comment under it.
- **A private repo returns `404` unauthenticated.** If the fetch fails or you cannot authenticate, say so in
  the review — "comment fetch unavailable, not verified". Never let a failed fetch read as "no comments".

### Order comments against commits

`/issues/<n>/timeline` is the single ordered source: `committed` events carry `sha` + `committer.date`,
alongside `reviewed`, `commented`, `line-commented`, and `head_ref_force_pushed`. Corroborate locally with
`git log --reverse --date=iso-strict --format='%H %cd %s' <base>..<head>`.

- A comment with **no later commit touching its file** cannot have been addressed in code. Say that plainly
  rather than guessing.
- A later commit to the same file is a _candidate_ fix, never proof. Read it.
- **A rebase or force-push destroys the ordering argument** — rewritten commits all get fresh committer dates,
  so every commit looks newer than every comment. When you see `head_ref_force_pushed` (or the base moved
  under the branch), fall back entirely to reading the code at head.

### Outdated vs live — read the right field

Measured on real data (PR 384: 12 of 26 inline comments):

- **`line: null` is the outdated signal.** Those comments still carry a stale non-null `position`, so testing
  `position` marks live comments outdated and misses the real ones.
- A **live** comment's `line` is its current position at head, `original_line` is where it was written, and
  `commit_id` advances to the SHA that mapping is valid for while `original_commit_id` stays fixed.
- For an outdated comment, read what the reviewer actually saw:
  `git show <original_commit_id>:<path>` around `original_line`. If that SHA is not local, re-fetch the PR
  head ref or `git fetch origin <sha>` — a force-pushed parent may be gone. Then locate the same logic at head
  **by content** (grep the symbol), not by line number.
- **Outdated means the diff moved, nothing more.** It does not mean addressed and does not mean invalid. An
  outdated comment whose objection survives at the new location is still a live finding.

### Threads, replies, and resolution state

- Group by `in_reply_to_id` (root = its own `id`) and review the thread, not isolated comments. The last reply
  is often "fixed" or "done" — that is a claim to verify at head, not a conclusion.
- `updated_at != created_at` means the body was edited; `minimized` means it was hidden.
- Resolution state is GraphQL-only and needs a token:

    ```sh
    gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequest(number:<n>){
      reviewThreads(first:100){nodes{isResolved isOutdated path line
        comments(first:20){nodes{databaseId author{login} createdAt body}}}}}}}'
    ```

    Without a token, record that resolution state was unavailable. **Never infer resolved from silence, and
    never treat resolved as addressed** — the author resolves their own threads, and resolving is a UI click.

### Give every thread exactly one status

The API only narrows the candidates; each status is a claim you verify in the code at head:

- **ADDRESSED** — the objection no longer holds. Cite the commit that fixed it and the head line.
- **PARTIALLY ADDRESSED** — the reported symptom is gone, the underlying hole is not. This is your own finding
  in the matching lens section, 🔴 or 🟠.
- **NOT ADDRESSED** — head still exhibits it. Finding in the matching lens section, credited to the commenter.
- **OUTDATED-BUT-LIVE** — `line: null`, the code moved, the objection survives at its new location. Link the
  new location, not the dead one.
- **SUPERSEDED** — the code it pointed at is gone; nothing left to fix.
- **Human assessment needed** — the inspected evidence cannot settle the claim or intended behavior. State the exact missing decision or evidence and the recommended direction; do not guess another status.
- **DISPUTED** — you verified it is wrong. One line on why, and credit the reasoning anyway.
- **SELF-ECHO** — a paste of one of your own earlier review files. These reviews get posted as PR comments, so
  the next run reads its own output back. Recognize it by shape (`**Bottom line:**`, the severity dots, `Fix
<ID>-FIX` callouts) and confirm by diffing the body against the files in
  `temp/pr-github-reviews/<n>/`. Never treat it as independent reviewer feedback and never re-credit it as a
  caught issue.

### New since the previous review

When `temp/pr-github-reviews/<n>/` already holds review files, establish a cutoff and mark everything after it
**NEW**:

- Prefer the `created_at` of the SELF-ECHO comment carrying the previous review.
- Otherwise use the previous file's mtime:
  `date -u -r temp/pr-github-reviews/<n>/<N-1>-review.md +%Y-%m-%dT%H:%M:%SZ`.

A re-review must also re-adjudicate **its own** prior findings against the new commits, using the same statuses
— an unchanged 🔴 stays 🔴 with the same ID, and a fixed one is stated as fixed rather than dropped silently.

## Step 4 — Verify CI evidence before running checks

Read the target repository's root and applicable nested `AGENTS.md` testing sections. Identify the canonical
full test command and any separate required test gates, including browser tests.

**Do not rerun tests that already passed in CI for the reviewed PR head.** Check GitHub's completed jobs and
verify their commit SHA and scope before starting local tests. Reuse successful full-suite, focused, and browser
test results. Passing CI does not replace code review or examination of test coverage.

- Record the reviewed head SHA, CI run/job links, conclusions, and which required gates they cover. If CI tests
  a synthetic merge commit, verify that it includes the exact reviewed head and record that distinction.
- A result for an older head, or a failed, cancelled, skipped, pending, or unavailable job, is not a passing
  result for the current review. Do not infer test success from an unrelated green build or workflow.
- Read test summaries when available. If the job succeeded but its test counts or logs are unavailable, report
  the verified success and that limit. Do not invent totals or rerun tests merely to obtain counts.
- Run only checks missing current successful evidence. A new focused reproduction is appropriate only for a
  concrete unresolved finding that existing CI does not exercise; explain that gap before running it. Do not
  rerun covered tests as routine review verification. An explicit user instruction not to run tests takes
  precedence: use static analysis and record any missing evidence instead.

For checks that still need local execution, compile contracts first (`yarn compile`), then typecheck both
configs in state-channels-plus (`yarn tsc --noEmit -p tsconfig.json` and
`yarn tsc --noEmit -p tsconfig.browser.json`), then run the missing test gate from `AGENTS.md`. Reuse matching
successful CI compile/typecheck evidence too. If compilation fails, report it before attempting dependent
checks. Let any required local gate finish; never describe a subset as the full gate.

### Strict serialization across PRs

- Only one PR may be under verification at a time.
- Never run compile, typechecks, focused tests, or the full gate for two PRs concurrently.
- Do not start any command for the next PR until the current PR's last test command has exited and its
  Hardhat/discovery teardown has finished.
- Write the current PR's review file before switching to the next PR.
- Do not parallelize verification commands within a PR when they contend for the same repository, generated
  artifacts, test nodes, logs, CPU, or memory. Run compile, typechecks, focused tests, and the canonical gate
  in a clear sequence.

### Reusing a completed user-run gate

If Luka has just run the `AGENTS.md`-declared canonical gate on the exact checked-out PR head and supplies the complete terminal
summary, use that result instead of duplicating the gate. Verify the branch and SHA first, confirm the run
completed, record it as a user-run gate, and inspect any persisted failure logs. Rerun only when the SHA
differs, the command was not canonical, or the evidence is incomplete.

Logging rules (from the repo's AGENTS.md — respect them, the persisted logs are the failure-analysis
workflow):

- The runner writes each run to a fresh `./logs/run-N/` and never touches earlier `run-*` dirs. Let it
  auto-increment. Do not pass `--logDir` and do not pass `--allow-logdir-purge`.
- Do not delete or prune `run-*` dirs — Luka compares across runs.

**Environment honesty.** If you are in a constrained sandbox, a starved run produces failures that look real:
30 s RPC timeouts, detached-promise timeouts, event-loop delay spikes. Do not report those as defects and do
not report them as green. State what you ran, what failed, that the failure mode is consistent with resource
starvation, and that it needs his machine to confirm. Equally, never wave a failure away as "environmental"
just because it is inconvenient — if the failing test exercises code the PR touches, say so.

An anomalous sandbox, detached-worktree, or overlapping-run result is **not** the representative gate when a
clean canonical run exists on the exact local PR branch. Keep the anomalous run out of the Bottom line and
verification totals; mention it only as discarded infrastructure evidence if it materially helps explain the
workflow.

## Step 5 — Review

Follow `/review-implementation` in full: read every new file and every changed region, read the repo's
`AGENTS.md` and any nested `test/AGENTS.md`, diff the implementation against any plan under `temp/plan/` that
it claims to build, and run the greps that prove the PR's claims.

When the repository has `./docs`, also run `/review-implementation`'s mandatory documentation inventory and
include its **📚 Doc** section. Read every applicable `docs/**/AGENTS.md`, check the PR's actual documentation
changes against those rules and the implementation, and report every required documentation file that is
missing or incomplete.

For a large diff, cover the lenses one at a time — plan adherence when applicable, contradictions, subsystem
correctness, trust boundary, races, performance, code reuse, dead code/cleanup, AGENTS.md adherence, contracts,
tests — and finish each before starting the next, so a wide diff
does not become a shallow pass over everything. If your harness supports parallel subagents, fan them out by
lens; then **verify every claim yourself in code before writing it down**. Subagents disagree with each other
and are confidently wrong often enough that an unverified relayed finding will embarrass you — when two
disagree, adjudicate in the source and say which one was right.

### Coverage-completeness gate

The full suite is a regression signal, not proof that the PR tests its own behavior. Before writing:

1. Enumerate every changed production behavior and every caller affected by it, including normal, no-op,
   boundary, invalid/missing-input, failure, retry/recovery, trust-boundary, and concurrent paths.
2. Build `/review-implementation`'s split matrix: exhaust component-level variations with black-box unit
   cases, then map affected external boundaries to representative E2E workflows. Read the bodies; do not
   credit filenames, broad green suites, indirect setup, or downstream failures.
3. Inspect skipped/pending relevant tests. Apply Step 4 before any focused reproduction; passing CI does
   not remove a coverage finding for a skipped relevant test.
4. For `state-channels-plus`, require exhaustive unit coverage of meaningful internal variations and E2E
   coverage of each materially affected system interaction. Do not duplicate every unit permutation in E2E.
5. Report every missing tier and weak assertion in **🧪 Tests**, even when the canonical full gate is green.
6. Do not stop after the most important three or four gaps. Give each distinct missing unit variation its own
   concise bullet. Give each missing E2E integration contract or materially distinct observable workflow its
   own bullet; combine internal permutations that exercise the same system interaction. There is no
   per-section bullet cap.

Do not finish the review until every changed production behavior has an explicit coverage disposition.

### Reuse and ownership gate

For every added or moved operation, search by both names and semantics across the repository. Trace all
callers and sibling services/pipelines, then identify the one canonical owner. Look for:

- duplicated full flows, not only duplicated helpers;
- alternate callers that bypass stronger validation, recovery, ordering, deduplication, encoding, caching,
  logging, or error policy;
- moves that leave the old implementation or some callers alive;
- new convenience helpers that recreate an existing service operation under a different name.

Report split ownership in **♻️ Code reuse** with both implementations linked and a concrete consolidation.
A reused low-level helper does not make duplicated orchestration acceptable.

## Step 6 — Write the file

**Path:** `temp/pr-github-reviews/<pr_number>/<N>-review.md` — `<N>` is an incrementing counter, so check the
directory first and use the next free number (`1-review.md`, then `2-review.md`). `temp/` is gitignored.

**Meta line** under the title must carry: repo · branch · `#<pr> <head> → <base>` · the reviewed SHA · file
count. Flag there if the reviewed SHA is not the PR head, and if the branch is the base of other open PRs.

Immediately after the meta line, add one single-line document marker:

```markdown
<!-- pr-review-document {"schema":2,"repo":"owner/repo","pr":403,"headSha":"<full head SHA>","baseSha":"<full base SHA>"} -->
```

Use the full SHAs recorded in Step 1. This marker is the publisher's source of truth.

Add `## Introduction to the PR` immediately after the document marker and before the Bottom line. This is only for
`/review-pr`: keep both key decisions and the summary inside this existing section; do not add a separate
top-level decisions section or change the extension.

Start with **Key decisions incorporated.** Give a few short decision sentences in plain technical English:
Use ..., Remove ..., Preserve .... Include only decisions supported by the PR's code and documented intent;
do not present a proposal or reviewer recommendation as an incorporated decision. If a documented decision
is not implemented, report that mismatch in the findings. For a small PR, one decision is enough.

Follow with **Summary.** In 2–4 concrete sentences, explain what the PR changes, the main execution path,
and the intended observable result. Keep both parts descriptive; findings, praise, and the review verdict
belong below. Use bold inline labels and prose, not nested headings or Markdown lists: the extension renders
this section as inline Markdown. For example:

```markdown
## Introduction to the PR

**Key decisions incorporated.** Use a separate signature allowance for each source. Preserve allowances through queue restoration.

**Summary.** The queue records each source's contribution before merging a block copy. Repeated copies share the same allowance, so one source cannot consume another source's signature slots.
```

Add `## Specification changes` immediately after the Introduction to the PR, before the comment timeline
and Bottom line. Read the PR's specification diff and explain the changes in plain technical English:

- State the previous rule and the new rule, who or what it applies to, and what observable behavior changes.
- Explain added, removed, or narrowed requirements, important boundaries and exceptions, and relevant rules
  that remain unchanged. Link the changed specification passages at the reviewed SHA.
- Distinguish normative specification changes from implementation reports, test mappings, or wording-only
  edits. Do not substitute a list of files or requirement IDs for an explanation of the design.
- If the PR changes no normative specification, say so explicitly. Report missing specification updates or
  disagreements with the implementation in the appropriate findings; do not describe intended behavior as
  an approved specification change.

Keep this section proportional to the PR, but give enough detail to understand its specification changes
without opening every diff.

### Selectable findings, destinations, Human notes, and publishing

Before writing the review, read `references/publishing.md` and follow its display and metadata format exactly.
Every finding must visibly say `Inline comment` or `General PR comment`; inline findings must show a pinned
target link and a short source preview outside the Human and AI marker blocks. End with the required publishing
dashboard so selection and posting remain usable without the visual VS Code editor.

The Human block is user-owned. Preserve non-placeholder Human text verbatim across re-reviews when the finding
ID survives; never rewrite, summarize, move, or delete it. Checked boxes are selection state only. Generating
or editing a review must never post anything.

The deterministic publisher is `scripts/publish-review.mjs`. Do not reproduce its GitHub requests ad hoc.
Never call it with `--post` on the user's behalf unless the user explicitly asks to publish findings in that
turn.

### `## 🗒️ Comment timeline` — required, directly after Specification changes

Only for `/review-pr`, and only when the PR has comments. One table, one row per **thread**, oldest first:

```markdown
| #   | Comment                      | Author    | When                           | Target                    | Status        | Evidence                                                                                     |
| --- | ---------------------------- | --------- | ------------------------------ | ------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| 1   | [inline](<comment html_url>) | sh3ll3x3c | Jul 8 (before `abc1234`)       | `src/x.ts:118` (outdated) | NOT ADDRESSED | still live at [head L131](permalink); no commit after Jul 8 touches this branch of the guard |
| 2   | [review body](url)           | daiagi    | Jul 12 (NEW since 1-review.md) | —                         | ADDRESSED     | fixed in `def5678`, see [L204](permalink)                                                    |
```

- Link the comment by its `html_url` — that URL is stable and lands on the thread.
- **When** carries the ordering fact, not just a date: which commit it precedes/follows, and `NEW` when it
  post-dates the previous review's cutoff.
- **Target** is `path:line` at head for a live comment, and the _new_ location for OUTDATED-BUT-LIVE, tagged
  `(outdated)`. Never cite the dead line as if it were current.
- **Status** is one of the Step 3 statuses, verbatim.
- **Evidence** is what you checked: the fixing commit, the surviving head line, or "no commit touches this
  file after the comment".
- Close the section with one line of counts (`8 threads: 3 addressed, 1 partial, 3 not addressed, 1 disputed`),
  a note when resolution state was unavailable, and a note when the branch was force-pushed or rebased since a
  comment was written.
- **Every NOT ADDRESSED, PARTIALLY ADDRESSED, and OUTDATED-BUT-LIVE thread also gets a finding bullet** in its
  lens section, credited to the commenter and cross-referenced by the timeline row number. The table is the
  index; the lens section carries the argument and the `Fix ID-FIX`.
- SELF-ECHO rows stay in the table (they explain the cutoff) but never produce a finding.
- The 🧹 Miscellaneous green summary may only claim there was nothing to re-verify when this table's counts
  back that up, and never when a fetch failed.

### Links must be GitHub permalinks, not machine-relative paths

This review gets read by other people — on GitHub, in Slack, in a PR comment. A `../../../../src/foo.ts#L12`
link resolves only on the machine that wrote it, so it is worthless the moment the file leaves your disk.
`/review-implementation`'s "link every code reference to a concrete line" rule stands; here the link has to be
a URL.

- **Every code reference is a permalink** of the form
  `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<line>` (or `#L<start>-L<end>` for a range).
- **Pin a commit SHA, never a branch name.** `blob/main/…` and `blob/<branch>/…` rot the moment anyone pushes
  — the line numbers silently start pointing at different code. A SHA permalink is stable forever.
- **Pin the PR head SHA**, because that is the code reviewers see in the PR. If you reviewed a different local
  SHA (see Step 1), still link the PR head, and say in the meta line which SHA you reviewed and where the two
  differ — but only after confirming the files you cite are identical between them, or the line numbers will
  be wrong.
- **Verify the SHA is on the remote before using it.** A local-only or force-pushed-over commit 404s or is
  eventually garbage-collected:
  `curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<sha>"`
  → expect `200`. Spot-check a few finished links the same way before you hand the review over.
- **Derive `<owner>/<repo>` from the remote** (`git remote get-url origin`), not from memory.
- **Exception — private docs.** Sibling reviews and plans under `temp/` are gitignored and have no GitHub URL.
  Reference those by filename in plain text, or keep a relative link and mark it as local; never fabricate a
  GitHub URL for a file that was never pushed.

## Reporting test failures — non-negotiable

Report the evidence accurately, whether it comes from CI, a user-run gate, or local verification:

- **Put the real numbers in the Bottom line**, not "tests pass". Name the exact canonical command and report
  its N passing / M failing result alongside compile and typecheck results when those totals are available.
  For reused CI, link the successful jobs and name the reviewed SHA; state when counts are unavailable.
  Never imply that reused CI was run locally.
- **Name every failing test** in the 🧪 Tests section: the test title, its file, the assertion or error
  message, and a link to its log under `./logs/run-N/`. One bullet per distinct failure, red.
- **A failure in code the PR touches is a 🔴 that blocks**, and it belongs in the Bottom line's blocker count.
- **"Pre-existing failure" is a claim you must prove.** A test that is new in the diff cannot be pre-existing
  — check `git diff --name-status` before saying it. To dismiss anything else as pre-existing, confirm it
  fails on the base branch too (use a throwaway worktree: `git worktree add <tmp> <base>` — never `git stash`
  and never disturb his working tree or index). If you did not confirm it, write that you did not.
- **If the gate did not finish** (timeout, crash, watchdog), say so explicitly and give the partial result.
  Never let an incomplete run read as a pass.

## After

Point to the review path. In chat give only: the PR you reviewed (number, head → base) and the SHA, the
verification results (CI links or local results, available test counts, and failing test names), the comment
counts (how many threads, how many still not addressed, how many new since the last review), the Plan Adherence
result when applicable, the 🔴s, and the open questions. The file carries the rest.

## Automated service override

For this bundle, read `references/automation.md` first. It overrides execution, checkout, test, publication and tool instructions in this document and inherited skills.
