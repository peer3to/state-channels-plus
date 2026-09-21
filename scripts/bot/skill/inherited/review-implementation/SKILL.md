---
name: review-implementation
description: Luka's private convention for reviewing an *implemented* change (the actual code diff, not a plan) in his repos (state-channels-plus, peer3-poker-web, poker-contracts). Use whenever he says "review this implementation", "review the code", "review the PR", "poke holes in what was built", or points at a temp/plan-implementations/N-name/ implementation and asks what's wrong / did it break anything. Reads the real diff and latest implementation record, reuses current test results instead of rerunning them, runs only missing or stale verification, diffs the code against the plan under temp/plan, and writes a blunt, code-grounded, severity-tagged review under temp/plan-implementation-reviews/N-name/M-review.md. Pairs with /implement-plan (builds) and /review-plan (reviews the plan before it's built).
---

# Implementation review (private — Luka's workflow)

## Reasoning effort

Use extra-high reasoning effort by default for every review. Override this only when the user explicitly
requests a different reasoning-effort level for the current review.

Review a landed change — the actual code — and write your verdict as a file. Same blunt, skimmable, severity-
tagged shape as `/review-plan`; `example-review.md` in this skill dir is the canonical output — match it. The
difference from `/review-plan`: you're reviewing **code that exists**, so you inspect current verification
evidence, run only checks that are missing or stale, and **diff the implementation against the plan** it
claims to build.

## Evidence and human assessment

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

## The one rule that governs everything

**A review is your concrete opinion, grounded in code you actually read and ran — not a recap.** Luka knows
what he built. He wants: is it right, did it break anything, what did it get wrong, where did it quietly
diverge from the plan. So:

- **Cut the what/why.** No "here's what this implements." Straight to the take.
- **Use the latest test evidence.** Read the implementation doc first. If its Testing and Tested state
  sections cover the current code, reuse those results and do not run those commands again. Run only checks
  that are missing, failed, unverified, or stale. Still read the test bodies and production paths yourself.
- **Diff against the plan.** The biggest findings are usually where the code silently did something the plan
  decided against (a swapped data structure, a dropped API, a widened scope). Read the plan, compare.
- **Be blunt and informal. No fluff; state uncertainty precisely.** If it's fine, 🟢 and move on.
- **Simple language — Luka must never have to decode a finding.** Write each finding the way you'd explain it
  out loud: lead with the concrete change in plain words, then walk cause → effect in order ("today X; the
  code makes it Y; that breaks Z"). No invented shorthand or metaphor labels that compress the idea — if a
  bullet is concise but needs a second read to parse, it failed. Example: not "Passive join ballast becomes
  live actors", but "Force-joined addresses stop being dead entries and become real peers that produce
  blocks."

## Full-review completion gate

A review is complete only when the whole applicable surface has an explicit disposition.

- Read every new file in full and every changed region with enough surrounding ownership, caller, and data-flow
  context to judge it correctly.
- Complete the plan-adherence, contradictions, behavior and coverage, reuse and ownership, documentation,
  instruction-adherence, and dead-code/cleanup audits. Resolve every row as verified, a finding, or a named
  blocker.
- Do not sample a large diff, stop after finding serious defects, cap the number of findings, or skip tests,
  harnesses, generated outputs, or documentation when they are part of the applicable change.
- Time, context size, diff size, green tests, and finding count are not completion criteria. Continue across turns
  or context compaction until the audit is complete.
- If a real blocker leaves any required surface unreviewed, write `Review coverage: INCOMPLETE` in the Bottom line,
  list every unreviewed file, plan item, review lens, and verification check with the reason, and do not approve the
  implementation. Otherwise write `Review coverage: COMPLETE`.

## Before writing — read, then verify

1. Find the latest applicable implementation doc
   (`temp/plan-implementations/N-<name>/N-implementation.md`) and read it before running any verification.
   Also read the plan it implements (`temp/plan/N-<name>/plan.md`). Note every place the doc says the impl
   _diverged_ or _renamed_ — those are leads.
2. Read the **actual diff**, not the doc's summary of it: `git diff --cached` / `git diff <base>...` /
   `git show`. Read every new file in full and the changed regions of every touched file.
3. Read the target repo's `AGENTS.md` + any nested one (`test/AGENTS.md`) — adherence is a review dimension.
   Record the canonical full test command they declare; do not rely on a command remembered or hardcoded by
   this skill.
4. If the repository has `./docs`, read `docs/AGENTS.md` and every nested `AGENTS.md` that applies to changed
   or required documentation, then perform the mandatory documentation inventory below.
5. Build the mandatory plan-adherence, contradictions, coverage, reuse, and dead-code/cleanup inventories below.
6. Compare the doc's Tested state with the actual `HEAD`, SHA-256 of `git diff --binary HEAD`, SHA-256 values
   for untracked production/test files, and whether any implementation file changed after its results. Treat
   the doc as current only when it is the newest record for this implementation and these values match.
7. **Reuse current results and run only missing or stale safe verification** (see below). Fold both reused and
   newly run results into the Bottom line and Tests section, and label which is which.

## Mandatory plan-adherence audit

Treat the plan as a deliverable checklist, not background reading:

1. Classify every plan item as production, tests, harness/fixtures, documentation, generated output,
   verification, explicit out-of-scope work, or explicit future work.
2. Map every in-scope item to exact implementation and evidence. A nearby feature, broad green suite, or
   implementation-record claim is not a disposition; read the code, test, document, or command result.
3. Check negative requirements too: removed code must be gone, forbidden paths must stay absent, preserved APIs
   must still work, and explicit scope boundaries must not be crossed.
4. Distinguish plan-approved future/out-of-scope items from silently deferred work. Only the former count as
   accounted for without implementation.
5. State one clear result in **📐 Plan Adherence**: either every plan item is implemented and accounted for, or
   list every missing/divergent item with evidence and the concrete work required. Never say “mostly,” “main
   path complete,” or “representative coverage” instead of enumerating the gaps.

Keep this private working matrix:

```text
plan item | category | required outcome | implementation/evidence | implemented/accounted/missing
```

## Mandatory contradictions audit

Cross-check the same behavior and claim across all four evidence layers: the normative specification,
implementation reports, verification reports, and actual source code and tests.

1. Read every applicable artifact in all four layers. If a layer does not exist, record it as absent; absence
   is a documentation or evidence gap, not a contradiction by itself.
2. Compare concrete claims pairwise. A contradiction exists when two layers make incompatible claims about
   behavior, ownership, API shape, lifecycle, failure handling, scope, coverage, verification results, or
   completion. Different wording, extra detail, or a missing statement is not enough.
3. Treat the specification as the normative contract unless the reviewed change explicitly and validly updates
   it. Source code is the authority for what currently runs. An implementation report cannot silently
   reinterpret the specification, and a verification report cannot claim coverage or a pass that its mapped
   test body or recorded result does not prove.
4. List every contradiction in **⚖️ Contradictions**. Quote or precisely paraphrase both incompatible claims,
   link each side, state the runtime or review impact, and say which artifact or code must change. Cross-reference
   another finding ID when the same defect is explained elsewhere; do not hide the contradiction only in that
   other section.
5. If none exist, include one green summary that explicitly says the specification, implementation reports,
   verification reports, and source code agree for the reviewed scope.

Keep this private working matrix:

```text
behavior/claim | specification | implementation report | verification report | source/tests | contradiction/fix
```

## Mandatory test-coverage inventory

Do not infer coverage from a green suite, test count, filename, or a comment saying a path is covered
transitively. Before judging the tests:

1. List every changed production symbol and every behavior it owns: normal path, empty/no-op path, boundaries,
   invalid or missing state, external-input failure, recovery/retry, and concurrency/interleavings.
2. Trace every production caller, including callers outside the diff, alternate services, worker/browser
   paths, and callers that bypass a newly safer path.
3. Map every meaningful component behavior and internal variation to an exact black-box unit test through
   the component's public surface. Read the body and fixture; prove it triggers the real owner.
4. Separately map every affected external integration boundary and representative observable workflow to an
   E2E test. Cover system-level success, failure, recovery, and races, but do not duplicate every unit input
   or boundary permutation unless it changes observable behavior or exercises a different integration.
5. Inspect skipped/pending tests. A skipped relevant case is a coverage gap, even if its comment calls it
   known, pre-existing, or covered elsewhere. When safe, run it or reproduce its premise with a focused probe.
6. Mark a behavior covered only when the test reaches the real owner and asserts the relevant outcome.
   Compilation, a broad green E2E, indirect setup, or "would fail downstream" is not direct coverage.
7. Make the unit inventory exhaustive, not representative. Keep enumerating until every meaningful internal
   variation has a disposition. Make the E2E inventory complete by integration contract, not by duplicating
   the unit matrix: every affected boundary and materially distinct system interaction needs a disposition.

Keep this private working matrix while reviewing:

```text
component behavior/variation | black-box unit test + assertion | affected integration contract | representative E2E + assertion | missing/weak coverage
```

For `state-channels-plus`, require exhaustive black-box unit coverage of the changed component and
representative E2E coverage of each affected system interaction. Do not demand an E2E copy of every unit
variation. Report every missing, skipped, mis-staged, assertion-free, or wrong-layer case in **🧪 Tests**.
Give distinct unit gaps separate bullets; group unit variations into one E2E gap when they exercise the same
integration contract and observable outcome.

## Mandatory code-reuse and ownership inventory

For every added or moved helper, method, type, query, storage walk, recovery flow, and orchestration path:

1. Search by symbol and by behavior. A differently named implementation can still duplicate the operation.
2. Trace all callers and compare sibling services/pipelines that perform the same job.
3. Identify the existing owner and whether the change reuses it, forks it, or bypasses a stronger path
   (validation, recovery, ordering, deduplication, encoding, caching, logging, or error handling).
4. Check that a "move" deleted the old implementation and migrated every caller.
5. Prefer one end-to-end owner for an operation. Reusing a low-level helper does not excuse duplicate
   orchestration such as `fetch → recover → load → decode` implemented in several services.

Record the searches and callers inspected. If ownership is split or behavior can drift, report it in
**♻️ Code reuse** with both implementations linked and a concrete consolidation target.

## Mandatory dead-code and cleanup inventory

Audit both newly added code and old code made obsolete by the change:

1. Trace every new or changed file, export, class, method, helper, type, flag, branch, fixture, harness control,
   and compatibility path to real callers or runtime entry points.
2. Find unreachable branches, unused exports, abandoned old implementations, stale adapters, redundant state,
   obsolete tests/fixtures, and configuration that no supported path reads.
3. Identify over-engineering: abstractions with one trivial use, parallel state machines, wrapper layers that
   add no policy, speculative extension points, and general machinery where a smaller existing owner suffices.
4. Separate proven dead or unnecessary code from deliberate public API, generated output, platform variants,
   and required compatibility paths. Do not call code dead from a name-only search.
5. Report each confirmed item in **🧼 Dead Code/Cleanup**, with deletion or simplification boundaries and the
   verification that proves cleanup is safe. If none exists, include one green summary saying the audit found
   no unused or unjustified machinery.

Keep this private working matrix:

```text
symbol/file/layer | callers or entry point | purpose | dead/redundant/over-engineered/required | cleanup
```

## Mandatory documentation inventory

Run this audit only when the repository has `./docs`; otherwise omit the **📚 Doc** output section.

1. Read the documentation workflow and rules from every applicable `AGENTS.md` under `./docs`. Follow links
   from those rules only as needed to identify required source, specification, implementation, verification,
   generated, index, ID, and open-question files.
2. Inventory every changed production, test, public API, protocol, lifecycle, or observable behavior and map
   it to the documentation artifacts those rules require.
3. Inspect the actual documentation diff and generated outputs. Check content against the implementation,
   confirm required files exist, and verify IDs, implementation/spec/test mappings, links, indexes, coverage
   records, and open questions are complete and internally consistent.
4. Run only missing or stale documentation validation or refresh commands required by the applicable docs
   instructions. Reuse current recorded results under the same freshness rules as tests.
5. Report every docs-rule violation and every missing, stale, conflicting, or unmapped documentation file in
   **📚 Doc**. Link both the implementation behavior and the documentation evidence.

Keep this private working matrix:

```text
changed behavior | applicable docs rule | required doc artifact/update | actual doc evidence | missing/conflicting work
```

## Verification evidence to reuse or run (and report)

Read the latest implementation doc before executing any command in this section.

- **Do not rerun a recorded check against the same implementation state.** This includes typechecks,
  compiles, focused tests, full gates, and proof greps. Reuse its exact result in the review.
- **Run only missing or stale checks.** Evidence is stale when the tested `HEAD`, tracked-diff SHA-256, or an
  untracked production/test file SHA-256 differs, or the document says code changed after the result. If only
  one area is stale, rerun only the checks affected by that area.
- **Do not invent freshness.** If the implementation doc lacks enough Tested state detail, say what cannot be
  matched and run the smallest missing verification. A newer review file does not make an older implementation
  record stale by itself.
- **Respect a direct instruction not to run tests.** In that case, inspect and report the available evidence
  and mark only the uncovered current checks as unverified.

- **Typecheck, when not already current** — state-channels-plus: `yarn tsc --noEmit -p tsconfig.json` **and**
  `-p tsconfig.browser.json` (both — shared code + exports touch the browser build). peer3: `pnpm typecheck`.
  poker-contracts: `pnpm typecheck`.
- **Compile when relevant and not already current** — state-channels-plus: run `yarn compile` when the build, contracts, generated
  types, or exported package surface changed.
- **The new/changed focused unit and E2E cases, when not already current** — state-channels-plus:
  `yarn test:parallel --grep "<case>"`; add `--e2e-only` when narrowing specifically to E2E discovery.
  Report pass/fail counts.
- **The canonical full gate, when not already current** — re-read the applicable `AGENTS.md` testing section,
  then run the command it declares after focused checks. Let it create a fresh `./logs/run-N/`; never purge
  or overwrite earlier run directories.
  If the environment prevents completion, report the partial result and the exact limitation instead of
  treating it as green.
- **Greps that prove the claims, when not already current** — if the change "migrates every X" or "removes all Y", grep for the leftover
  pattern and confirm only the deliberately-excluded sites remain (e.g. `rg "connect\([^)]*\.signer\)" test/`).
- **"Pre-existing failure" claims are guilty until proven** — if the doc waves off N failing tests as
  unrelated, note they must be confirmed failing on `master`/base before being dismissed.

## What to look for (the lenses → the sections)

- **Fundamental** — is the core mechanism right? **Where did the code diverge from the plan, and does the
  divergence break the plan's reasoning?** (A plan that chose data-structure X "to avoid race Y", implemented
  with Z that reopens Y, is the headline finding.)
- **Plan Adherence** — use the full plan-adherence matrix. State explicitly whether every item is implemented
  and accounted for. List every omission, substitution, silent deferral, forbidden addition, and unproven
  deliverable when the answer is no.
- **Contradictions** — use the contradictions matrix. List every incompatible claim across the specification,
  implementation reports, verification reports, and actual source/tests. Keep omissions in Plan Adherence or
  Doc unless another artifact makes the opposite claim.
- **Security = the trust boundary ONLY.** Byzantine peers, on-chain adversaries, anything an _external_ party
  controls crossing into us. Ignore internal wiring we fully control — we don't attack ourselves. Ask what a
  remote/adversarial party can _make happen_, and connect internal bugs to their external trigger (e.g. a
  Byzantine peer flooding disputes to amplify a nonce race).
- **Race conditions** — its own section. What genuinely goes wrong running the _honest_ software under
  concurrency; name the interleaving.
- **Performance** — new round-trips, chokepoints, extra providers/connections, unbounded waits, hot-path cost.
- **Tests** — use the coverage inventory. Label unit and E2E findings clearly. Unit findings exhaust the
  component's meaningful black-box variations. E2E findings name the integration boundary and representative
  system workflow, not every internal permutation. Include skipped or mis-staged tests, caller paths that
  bypass coverage, and any dismissed-as-pre-existing failures.
- **Code reuse** — use the ownership inventory. New code must not reimplement functionality that already
  exists; one behavior lives in one place. Compare semantic equivalents, not only matching names. Review
  whole flows and all callers, not just helpers: duplicated fetching, recovery, storage lookup, decoding,
  validation, ordering, and error policy are reuse failures even when they share a utility. Diff moved code
  against its origin and verify the origin was deleted.
- **Dead Code/Cleanup** — use the dead-code inventory. Find unused or obsolete code and simplify machinery
  whose complexity has no live requirement or caller. Keep this separate from semantic duplication in Code
  reuse and from scope/API changes in Miscellaneous.
- **AGENTS.md adherence** — its own section. Walk the diff against the repo's `AGENTS.md` (+ any nested one
  like `test/AGENTS.md`) and flag **every** line that breaks a documented convention: naming, class layout
  (`{fields, then methods}` — never interleave), `console.*`, type casts, `Awaited<ReturnType<...>>` and other
  type wrappers instead of the named import, encoding, platform/output dirs, comment style (short, non-obvious).
  Cite the specific rule and link the offending line.
- **Doc** — only when `./docs` exists. Use the documentation inventory to enforce all applicable
  `docs/**/AGENTS.md` rules, verify changed docs match the implementation, and identify every required doc
  artifact that is absent or incomplete.
- **Miscellaneous (scope)** — scope/API creep or regressions (a fix that quietly drops a product API,
  changes a public setup surface, or narrows supported inputs).
- **Open questions** — the real decisions only Luka can make. End here.

Always hunt for **what the implementation quietly changed or didn't account for** — highest-value output.

## Output shape (see `example-review.md`)

Sections, in this order. Keep every section; when it has no red/orange/yellow finding, use one compact green
summary for the whole section:

1. **Title** — `# Review: implementation of plan N — <what it changes>`; meta line
   `repo · branch · reviews [N-implementation.md](./N-implementation.md)`.
2. **Bottom line** — 2–3 sentences: approve / approve-with-fixes / rework, the one-line why, and the verified
   state. Separate results reused from the current implementation record from checks run during the review,
   and state what passed or failed. State how many 🔴s block.
3. **📐 Plan Adherence** · 4. **⚖️ Contradictions** · 5. **🧱 Fundamental** · 6. **🔒 Security (trust boundary)** · 7. **🏁 Race conditions** · 8. **⚡ Performance** · 9. **🧪 Tests (regressions / gaps)** · 10. **♻️ Code reuse** · 11. **🧼 Dead Code/Cleanup** · 12. **📏 AGENTS.md adherence** · 13. **📚 Doc** — include only when the repository has `./docs` · 14. **🧹 Miscellaneous (scope)** · 15. **❓ Open questions**

## Formatting rules (non-negotiable)

- **Give every bullet a stable reference ID.** Format it as `<section><severity><ordinal>`:
  section is `H` Plan Adherence, `X` Contradictions, `F` Fundamental, `S` Security, `R` Race,
  `P` Performance, `T` Tests, `C` Code reuse, `K` Dead Code/Cleanup, `A` AGENTS.md, `D` Docs,
  `M` Miscellaneous, or `O` Open questions;
  severity is `R` red, `O` orange, `Y` yellow, or `G` green; ordinal is the bullet's
  1-based position within that section. Examples: the first red Fundamental bullet is `FR1`; the second
  yellow Security bullet is `SY2`. Put the ID immediately after the severity dot, then the confidence percentage and an em-dash:
  `- 🔴 **[FR1] 90% — ...**` (see Evidence and human assessment).
- **Put the proposed remedy in a separate callout directly below every bullet.** Label it with the finding
  ID plus `-FIX`, so it can be referenced independently. Do not use `[!TIP]` or another callout prefix. Use
  this exact shape:

    ```markdown
    - 🔴 **[FR1] 90% — Finding.** Evidence and impact.

        > **Fix FR1-FIX**
        >
        > Concrete code change, where it belongs, and the test or observable result that proves it worked.
    ```

    A fix must be actionable, not advice such as “investigate”, “consider”, or “handle this.” Name the mechanism
    to change, the preferred approach when the evidence supports one, and the acceptance test. For a section's
    single green summary, write `No change required.` For an open question, state the recommended decision and
    what changes after that decision. The box is intentionally not part of the feedback bullet.

- **Severity dot on every finding:** 🔴 blocks landing · 🟠 worth a look · 🟡 nit · 🟢 good / fine. Lead with
  the dot so the review skims by scanning for red.
- **Do not mix green praise into a section that has findings.** If a section contains any 🔴, 🟠, or 🟡,
  omit all 🟢 bullets from that section. If it contains none, write exactly one 🟢 summary bullet for the
  section. Verification results belong in the Bottom line even when the Tests section has findings.
- **One finding = one bullet:** keep the bold lead clause and evidence concise, but completeness wins over
  section length. Do not combine independent findings, omit lower-severity findings, or cap a section at
  three or four bullets. A section may contain as many concise bullets as the evidence requires.
- **Link every code reference to a concrete line** — ``[`reset()`](../../../src/evm/signer/HostNonceManager.ts#L23)``.
  Paths are relative to the review file; from `temp/plan-implementation-reviews/N-name/` the repo root is `../../../`. Grep the real
  line first.
- **Put real command results in the Bottom line.** Say whether each result was reused from the current
  implementation record or run during this review. Repeat a result in Tests only when it failed or qualifies
  a coverage finding.
- **Sort within every section:** Human assessment needed first, then severity 🔴, 🟠, 🟡 within each certainty group. A clean section's single 🟢 summary is last by
  definition. Keep each bullet tight; do not shorten the section by dropping valid findings.

## Location & naming

- Path: `temp/plan-implementation-reviews/N-<name>/M-review.md` — **mirror the implementation's `N` and name**. `M` is an
  incremental review counter for that change (`1-review.md`, then `2-review.md`). `temp/` is gitignored.

## House rules (from memory)

- Use the canonical full gate declared by the applicable `AGENTS.md` and preserve prior `./logs/run-N/`
  directories.
- Don't disturb the working tree/index to inspect a base revision — use a throwaway worktree, not `git stash`.

## After

Point to the review path. In chat give only: the verdict, what current results you reused, what additional
checks you ran, the Plan Adherence result, the 🔴s, and the open questions. The file carries the rest.
