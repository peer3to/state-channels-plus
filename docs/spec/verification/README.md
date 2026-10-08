# Verification Layer

> **Agent status:** Rebuilt around one report per test file with full-coverage test-ID assignment.
> **Engineer verification:** Pending.

This layer answers: **what do the real tests actually prove?** It holds two things: exactly one
maintained report per repository test file with executable declarations, mirroring the `test/`
tree (`tests/test/unit/ValidationService.test.ts.md`), and the tool-written
[`requirements.md`](./requirements.md), one block per requirement listing how many of its
specification cases are tested and which are not. It also keeps the layer's open-questions register.
Fixtures, harness code, utilities, runners, and configuration get no reports.

## Contents

- [Report template](#report-template)
- [Assignment rules](#assignment-rules)
- [Deleted test support](#deleted-test-support)
- [Static analysis](#static-analysis)

## Report template

Each report ([canonical example](./tests/test/unit/ValidationService.test.ts.md)) has:

1. A header: a `Test file:` link and — when the suite targets one production component — an
   `Exercises:` link to its implementation source report.
2. **Overview** — short prose: what the suite drives, through which harness/entry point, what the
   oracles assert, and what is out of scope.
3. **Tests** — one bullet per declaration, ``- `<test name>`: <IDs>``, listing the test IDs that
   declaration covers in full, or `none`. The name is the declaration's own title, or its full
   `a > b > c` selector when that title repeats in the file.

## Assignment rules

- **The permutation is the unit of evidence.** Assignable IDs are only the planned permutations:
  specification `REQ-*/INV-*.T<n>.P<n>` and implementation `UNIT-TEST-*/INTEGRATION-TEST-*.P<n>`.
  A root test ID (`.T<n>`, or a bare `UNIT-TEST-*`/`INTEGRATION-TEST-*`) only names the family in
  its planning table and is never assignable in a test bullet.
- **Full coverage of that permutation only.** A bullet lists a permutation ID only when that single
  test demonstrably exercises that one permutation as defined, including its oracle. Partial
  credit is never recorded. Judge each permutation independently: a permutation a test satisfies
  in full is assigned even when its sibling permutations remain unassigned — the unassigned
  siblings are the tracked gap, never a reason to withhold the assignment.
- **One test per permutation ID.** A permutation ID may be assigned to at most one test
  declaration across the whole tree; duplicates are reported by static analysis and must be
  reduced to the single strongest test.
- **One test may cover several permutation IDs** — preferred, since it keeps the suite small.
  This includes permutations from both layers: a test that fully satisfies a specification
  permutation and an implementation permutation carries both.
- Tests with no assigned ID stay listed with `none`; static analysis reports them as unreferenced.
- IDs are bare, not links: grep finds them, and `yarn spec:ids:fix` strips any link.
- A genuinely out-of-scope test file may use `// @spec-test-coverage-ignore: <reason>` in its
  first ten lines. HTML page fixtures can use the same marker inside an HTML comment.

## Deleted test support

The impact check reads [deleted-test-support.json](../deleted-test-support.json) for removed
helpers that had no inline exclusion before deletion. Each exact repository path needs a
nonempty reason explaining why its removal loses no executable coverage. This register applies
only to paths deleted by the selected diff; it cannot exclude live files or deleted test files.
Existing support files use the inline marker described above. Do not register a removed test
as support or use this register instead of migrating its coverage.

## Static analysis

The graph reads each report's test bullets, resolves each name to a declaration in the test file
the report mirrors, and treats every listed ID as an exact mapping claim for that declaration.
[generated/verification-coverage.md](../generated/verification-coverage.md) reports: specification
IDs with no evidenced permutation, planned test IDs without an assigned test, test files without
reports, tests with no assigned ID, and test IDs assigned to more than one test.
[generated/traceability.md](../generated/traceability.md) is the navigable map of what exists.

`requirements.md` and the checkbox on every implementation-layer case bullet are derived from
these bullets by `yarn spec:ids:fix` and checked by `yarn spec:ids:check`, which also names every
bullet that matches no declaration or an ambiguous one. Never edit them by hand; a merge conflict in either is
resolved by rerunning `yarn spec:ids:fix`.

Oracle, environment, permutation, and evidence questions belong in
[open-questions.md](./open-questions.md).
