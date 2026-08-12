# Verification Specification

> **Agent status:** All mirrored subjects use the maintained verification shape; evidence audits remain incomplete.
> **Engineer verification:** Pending.

The primary verification tree mirrors the specification and implementation subject trees. For every
subject `A`, `verification/A` is written after the specification, implementation analysis, and tests
exist. The matching subject already implies those inputs, so do not add an `Upstream dependencies`
section.

Each subject begins with a `Verification overview` containing a `Status` field and dedicated
`Specification-test adherence`, `Implementation-test adherence`, `Contradictions`, and `Missing`
subsections. At the bottom, `Specification test traceability` accounts for every specification permutation and
`Implementation test traceability` accounts for every implementation unit/integration permutation.
Both map to exact `[test](...#L...)` or `[test family](...#L...)` declarations and state every
remaining gap. Inspect each real test body and record whether its setup and oracle provide good,
partial, wrong/misleading, adjacent-only, or missing coverage directly in the relevant traceability
row. When one declaration covers multiple cases, it may appear in each applicable case row; the
case—not the declaration—is the unit of traceability. Broad file links and filenames are not evidence.

The two traceability matrices are intentionally the only evidence inventory. Do not add a consolidated
test list, an upstream-dependency section, or a second strategy narrative: the mirrored path identifies
the inputs, while each row carries its own setup/oracle judgment. A missing real test remains an explicit
`none — gap` row; structure must never manufacture evidence.

Unresolved oracle, environment, permutation, or evidence decisions belong in
[open-questions.md](./open-questions.md). Supporting workflow documents may hold shared methodology,
but they cannot replace the matching subject's inventory and traceability.

## Subject tree

- [Concepts](./concepts/)
- [Protocol](./protocol/)
- [Security](./security/)
- [Data types](./reference/data-types.md)

The older lifecycle, dispute, transport, runtime, security, and distributed-testing documents are
supporting analyses only. They may explain shared environments or workflows, but they cannot own a
specification or implementation permutation or substitute for an exact row in a mirrored subject.

The generated [verification coverage](../generated/verification-coverage.md) reports planned tests missing
from their subject's verification file, planned tests without exact repository-test references, missing
specification/implementation/verification counterparts, and repository tests not referenced by verification.
