# Implementation Specification

> **Agent status:** All subject mirrors use the maintained structure; exhaustive source reports and test plans remain in progress.
> **Engineer verification:** Pending.

This layer explains how this repository implements the neutral protocol specification. Agents author
and maintain it; engineers verify it against the real source.

## Subject mirror rule

The primary tree mirrors the specification tree:

```text
specification/<subject>.md -> implementation/<subject>.md
```

Each subject document begins with an actionable implementation overview and an exhaustive source inventory:

| Source file | Specification IDs |
| --- | --- |

The overview contains a `Status` field plus dedicated `Specification adherence`, `Specification
contradiction`, and `Missing` subsections. It distinguishes incomplete coverage from behavior that
directly conflicts with the specification. Every contradiction and missing capability states its
required resolution in place; do not repeat the same items in a separate work list. The inventory
contains only files in which the listed IDs can actually be
audited; generic roles, per-row status boilerplate, and duplicated symbol lists do not belong there.

After the overview, define the implementation-wide `Assumptions and constraints`, then present
`System design` and the `System integration test plan` so the reader understands the implemented
system and its internal composition before inspecting files. Then list `Source inventory`, nesting every inventory item beneath it in the contents menu. Each
inventory row has one
matching `### Source report: <filename>` anchor. That report links the source, repeats only its
auditable specification IDs, and records its implementation responsibility, design decisions,
assumptions and constraints, and an exhaustive file-specific `#### Unit tests` table. Every unit
case has its own `UNIT-TEST-*` identity and states all required permutations and the observable
oracle. Number independently coverable permutations as `<UNIT-TEST-ID>.P1` through `.PN`, exactly
as specification plans number their permutations. Optional columns link the case to relevant specification IDs and specification test IDs;
an implementation-only case may leave either mapping empty. The compact table answers “what files
implement this subject?”; the reports answer “how does each file do it and how must that file be
tested?”

Render requirement and test identities as linked inline code—`[` + backticked ID + `](target)`—so
they retain code styling while remaining navigable. Requirements link to stable anchors at their
normative definitions. Unit and integration tests link to stable local anchors at their definition
rows; never use fragile generated line numbers for these identities.

The system integration plan covers interaction among the inventoried files from the top-down
system perspective. Every integration case has a stable
`INTEGRATION-TEST-*` identity, complete permutations and an oracle, with optional links to relevant
specification IDs and specification test IDs. Its permutations are likewise
`<INTEGRATION-TEST-ID>.P1` through `.PN`. Broader cross-system and end-to-end composition does not
belong here; the matching verification document owns it. The implementation layer defines unit and
integration obligations but not concrete test evidence.

The bottom conformance matrix joins every `REQ-*` / `INV-*` to current source evidence, design
decisions, implementation-specific test obligations, and gaps. Source evidence points to the
narrowest useful symbol or line. Every `src/` and `contracts/` file must occur in at least one subject
inventory or be reported as unaccounted by static analysis. Generated tools report omissions but
never create or edit maintained implementation documents.

Mechanically trivial files still require an explicit owning subject or a concrete `Not applicable`
rationale in the maintained classification. `Not applicable` must not hide protocol behavior.
Unresolved implementation decisions belong in [open-questions.md](./open-questions.md); demonstrated
defects belong in [the audit findings register](../audit/open-findings.md).

## Supplemental views

- Detailed files under `architecture/` are concrete reports owned by the neutral architecture, pipeline,
  RPC, or runtime subject named in their `Specification subject` field. They may refine implementation
  details but cannot introduce unowned protocol behavior.
- `operations/` contains repository-specific configuration and runbooks.
- [examples.md](./examples.md) records concrete examples without making them protocol requirements.

The generated [implementation coverage](../generated/implementation-coverage.md) reports specification and
implementation subjects without counterparts, plus files under `src/` and `contracts/` that no implementation
source inventory references. It does not assess implementation quality or the completeness of source reports.
