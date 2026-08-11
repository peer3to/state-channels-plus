# Specification maintenance instructions

These instructions apply to every file under `docs/spec/claude/`. Read
[README.md](./README.md) and [governance.md](./governance.md) before making a substantive change,
then read the owning technical document and its directly linked dependencies.

## Preserve specification authority

- Treat only engineer-approved content as normative. Do not silently resolve ambiguity or infer a
  design decision from current code.
- Separate observed behavior, inferred concerns, and proposed amendments. When implementation and
  intended behavior disagree, use an explicit `Current:` / `Intended:` pair and classify the
  divergence as `bug`, `missing`, `decision pending`, or `documentation debt`.
- Mirror every unresolved `**Open question:**` in [open-questions.md](./open-questions.md). When an
  engineer resolves one, update both locations, preserve the question ID, and record the decision
  provenance required by governance.
- Do not mark a document `Approved` without explicit engineer approval. Keep its `Status:` line
  accurate when an engineer places it in review or approves it.
- Keep `Future Work` non-normative. Do not present proposed behavior as an accepted requirement.

## Maintain document structure

- Keep the root README's overview and document map consistent with the authoritative focused
  documents.
- Organize the tree around stable architectural domains, not individual source files. Prefer links
  to stable directories and entry points over line-number links.
- At a depth proportional to risk and complexity, document purpose and observable contract;
  assumptions, constraints, and dependencies; invariants and failure behavior; verification; and
  future work.
- Preserve requirement and invariant IDs. Never reuse a withdrawn ID; mark it withdrawn.
- Give each important `INV-*` / `REQ-*` one owning traceability-table row containing its lifecycle
  state, normative statement, implementation disposition, and separate unit and e2e verification
  dispositions.
- Treat `State` as the next unresolved lifecycle gate, using exactly one of:
    - `Design pending` while the owning specification is not engineer-approved;
    - `Specified` when the specification is approved but its implementation disposition has not yet
      been reconciled;
    - `Implementation missing` when approved behavior lacks a conforming linked implementation;
    - `Verification gap` when implementation exists but the required unit/e2e evidence or dedicated
      verification matrices are incomplete;
    - `Audit pending` when design, implementation, and verification are complete but the current
      atomic PR/code review has not accepted them; or
    - `Audited` when that review has accepted the current specification, implementation, and tests.
- Update the state whenever its evidence changes. Do not advance it based on intention or a passing
  test alone; downgrade it when an affected spec, implementation, or test changes after its last
  passing audit. The generated audit recomputes every structurally provable prerequisite and reports
  mismatches. It permits either `Audit pending` or `Audited` after those prerequisites are complete,
  because static analysis cannot decide whether the substantive review passed.
- In the implementation cell, use one or more of these explicit labels:
    - `Current implementation:` followed by direct source links;
    - `Intended implementation:` when it differs from current behavior, together with the owning open
      question and future work;
    - `Pending implementation:` when the specified behavior has no conforming implementation; or
    - `Not applicable:` with a reason for a process/design-only requirement.
- In the verification cell, include both `Unit:` and `E2E:`. For each layer, map every individual
  test declaration required as specification evidence with `[test](path/to/file#L<declaration-line>)`,
  or state `Pending implementation:`, `none — gap`, or `Not applicable:` with a reason. A file or
  directory link does not establish which tests are evidence.
- Never leave an implementation or verification gap implicit or use an empty traceability cell.
  Additional implementation-specific tests may exist, but the traceability row must map the complete
  set of test declarations required to establish the specified behavior.
- Account for every extracted test declaration through an exact line-anchored `[test](...#L...)`
  link from an owning row's verification cell or a dedicated `## Verification specification`
  section. Use `[test family](...#L...)` for a dynamic or fuzz declaration and enumerate its generated
  permutations and expected oracles in the verification plan. A file containing no specification
  verification may opt out with `// @spec-test-coverage-ignore: <reason>` within its first ten lines.
  The reason is mandatory. Never use it to hide a missing specification, unmodelled permutation, or
  incomplete test family; those require updating the verification model.

## Maintain the verification specification

Every technical document has a dedicated `## Verification specification` section using the exact
subsections and table columns defined in [governance.md §3](./governance.md#3-verification-model):

- `### Unit / component black-box cases`
- `### Integration and end-to-end scenarios`

Every owned `REQ-*` / `INV-*` appears in both matrices, including a reasoned `Not applicable:` row
when a layer genuinely does not apply. A file link by itself is insufficient. Each theoretical case
states:

- the public behavior or cross-component workflow;
- preconditions/environment and valid domain setup;
- public stimulus or trigger;
- exact observable oracle and required absence of side effects; and
- meaningful normal, no-op, boundary, invalid/missing-state, failure, retry/recovery, ordering,
  concurrency/race, idempotence/replay, adversarial, and platform/runtime variations.

Derive unit/component cases from the public black-box contract, not private branches. Use real domain
objects and repository-approved collaborator boundaries. Derive integration/e2e scenarios from every
materially affected system boundary and observable workflow; do not duplicate unit permutations that
are indistinguishable at system level.

Compare existing tests against the theoretical matrices. Link every sufficient test directly and
mark absent or insufficient cases as `Pending implementation` or `none — gap`. Inspect the test body;
never infer coverage from a filename. Test names state condition/action and observable outcome. Flag
vague or misleading names such as “works,” “handles duplicates,” or “success,” and propose a concrete
replacement matching the actual setup and oracle.

## Keep documentation synchronized

- Update [open-questions.md](./open-questions.md) when an open question is added, changed, resolved,
  or moved.
- Update affected cross-references when a document, section, requirement, or invariant moves.
- Documentation references must resolve to files available in the repository: this specification
  tree, tracked source, contracts, scripts, and tests. Never cite or link ignored files, private
  generation notes, or an unavailable review artifact. Preserve durable conclusions by
  stating them in the owning document or open-question register.

## Follow the change loop

For a design, implementation, contract, or test change affecting specified behavior:

1. Identify all affected `REQ-*` / `INV-*` IDs before implementation. If no ID owns the behavior,
   add one or raise an open question.
2. Update the intended specification first and obtain engineer approval. Resolve every affected open
   question with the required decision record; if it cannot be resolved, stop the implementation as
   blocked rather than selecting an interpretation.
3. Update the code and the owning row's lifecycle state, implementation disposition, and links.
4. Add or update all necessary unit and e2e tests, update both evidence dispositions, and rerun the
   narrowest affected tests followed by the required repository gates.
5. Audit the linked implementation and test behavior against each normative statement and its full
   verification matrices. The PR/code review has a dedicated verification assessment covering
   black-box completeness, every affected integration/e2e boundary, execution evidence, gaps, and
   test-name improvements. Refresh all generated review artifacts below.

Every implementation PR is one atomic specification-to-code-to-test change. Before acceptance, its
reviewer must identify the affected IDs; verify that the specification is complete and introduces no
new documentation or source-coverage gaps; test the implementation against the normative behavior
and theoretical cases; inspect the linked tests for sufficient unit and e2e coverage; run the
affected verification; resolve every finding and open question; update all current-state links and
lifecycle states; and regenerate the static artifacts. An implementation PR with any unresolved
specification, implementation, verification, or audit gap is not acceptable. Git and the PR retain
the historical change; do not create a second in-tree review-history ledger.

PR descriptions and code reviews cite the affected IDs. Treat undocumented behavior, stale
source/test links, missing evidence, regressions, and unresolved specification drift as findings.
When resolving an affected open question, update both owning locations and record the decision
provenance, strongest rejected alternative, consequences, and affected layers.

## Regenerate traceability artifacts

[generated/traceability-index.md](./generated/traceability-index.md),
[generated/traceability-audit.md](./generated/traceability-audit.md), and
[generated/source-coverage.md](./generated/source-coverage.md), plus
[generated/test-coverage.md](./generated/test-coverage.md), are the generated review workspace.
Never edit the index or audit by hand; in source coverage, edit only classifications and rationales.
Run every generator and consistency check together from anywhere in the repository:

```bash
yarn spec:refresh
```

Do not format the generated audit report; its `--check` mode compares the deterministic raw output.

Refresh and commit all changed generated files whenever a change:

- adds, removes, renames, moves, or changes an `INV-*` / `REQ-*` definition;
- adds or removes an `INV-*` / `REQ-*` mention anywhere in the tree;
- moves or renames a document containing an ID definition or mention; or
- changes a traceability table, including implementation or verification evidence;
- adds, removes, renames, or moves an automated test; or
- adds, removes, renames, or moves a file under `src/` or `contracts/`; or
- changes source or tests in a way that affects a specified requirement or its evidence.

Every scanned `src/` TypeScript/JavaScript file and `contracts/` Solidity file must have one of two
dispositions:

- a direct file link from a maintained specification document; or
- an exact entry in
  [source-coverage.md](./generated/source-coverage.md), classified as
  `generated`, `non-protocol`, or `trivial-support`, with a concrete rationale.

Directory links do not establish file coverage. Never add a broad pattern or classify a file as
trivial merely to clear the report. Inspect an unreferenced file first: protocol behavior means the
owning specification is missing or stale; only genuinely generated, non-protocol, or mechanically
trivial support code receives an omission classification. The refresh command adds newly
unreferenced files as `Missing review`, preserves agent-edited classifications and rationales, and
removes entries that become directly referenced or disappear. A `Missing review` row is an
unresolved review finding.

Resolve duplicate definitions and every reported "mentioned but not defined" ID before handing off
the change. The audit report identifies missing explicit implementation states, missing unit/e2e
dispositions, missing/incomplete dedicated verification matrices, broken local links, and automated
test declarations not mapped as evidence. Test discovery includes conventional test/spec filenames
and test files invoked directly by `test` package scripts; extraction covers Mocha-style declarations,
Foundry test/fuzz functions, and package-script test entrypoints. Existing debt must remain visible;
fix every affected row and do not add new gaps. The refresh command performs the audit's stale-output
check. `node docs/spec/claude/tools/audit-traceability.js --check` checks only the main audit for stale
generated output.
`yarn spec:refresh:strict` regenerates everything and fails on every reported issue; it becomes the
clean-tree gate once the existing report is cleared.

The tools validate structure only. They do not inspect runtime behavior, run tests, or prove that
implementation and evidence satisfy the specification.

## Validate documentation changes

Before handing off:

1. Run the unified refresh command when any trigger above applies.
2. Inspect the generated diffs and confirm ownership, statements, reverse references, implementation
   states, evidence dispositions, unreferenced-test findings, and every source-coverage review row
   are correct.
3. Check every changed relative link and every implementation/test evidence link.
4. Confirm open questions, `Current:` / `Intended:` divergences, lifecycle states, and document
   statuses remain synchronized.
5. Rerun the unit/e2e evidence affected by the changed IDs and record the exact commands/results.
6. Run `git diff --check`.

When auditing a requirement, read its normative definition, inspect the linked implementation, and
evaluate the linked tests against the required behavior. Do not infer `implemented`, `verified`, or
`audited` merely because a traceability cell contains a link.
