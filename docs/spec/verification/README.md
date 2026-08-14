# Verification Layer

> **Agent status:** Rebuilt around one report per test file with full-coverage test-ID assignment.
> **Engineer verification:** Pending.

This layer answers: **what do the real tests actually prove?** It contains exactly one maintained
report per repository test file with executable declarations, mirroring the `test/` tree
(`tests/test/unit/ValidationService.test.ts.md`), plus the layer's open-questions register.
Fixtures, harness code, utilities, runners, and configuration get no reports.

## Contents

- [Report template](#report-template)
- [Assignment rules](#assignment-rules)
- [Static analysis](#static-analysis)

## Report template

Each report ([canonical example](./tests/test/unit/ValidationService.test.ts.md)) has:

1. A header: test file link, `Status`, and — when the suite targets one production component — an
   `Exercises` link to its implementation source report.
2. **Overview** — short prose: what the suite drives, through which harness/entry point, what the
   oracles assert, and what is out of scope.
3. **Tests and covered test IDs** — one row per declaration (name links to the exact line in the
   test file) and a `Covers` cell listing the test IDs that declaration covers in full.

## Assignment rules

- **The permutation is the unit of evidence.** Assignable IDs are only the planned permutations:
  specification `REQ-*/INV-*.T<n>.P<n>` and implementation `UNIT-TEST-*/INTEGRATION-TEST-*.P<n>`.
  A root test ID (`.T<n>`, or a bare `UNIT-TEST-*`/`INTEGRATION-TEST-*`) only names the family in
  its planning table and is never assignable in a `Covers` cell.
- **Full coverage of that permutation only.** A row lists a permutation ID only when that single
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
- Tests with no assigned ID stay listed; static analysis reports them as unreferenced.
- IDs are always links to their definition anchors.
- A genuinely out-of-scope test file may use `// @spec-test-coverage-ignore: <reason>` in its
  first ten lines.

## Static analysis

The graph parses each report's table rows (`[selector](<path>#L<line>) (line <line>) | <covers>`)
and treats every listed ID as an exact mapping claim for that declaration.
[generated/verification-coverage.md](../generated/verification-coverage.md) reports: specification
IDs with no evidenced permutation, planned test IDs without an assigned test, test files without
reports, tests with no assigned ID, and test IDs assigned to more than one test.
[generated/traceability.md](../generated/traceability.md) is the navigable map of what exists.

Oracle, environment, permutation, and evidence questions belong in
[open-questions.md](./open-questions.md).
