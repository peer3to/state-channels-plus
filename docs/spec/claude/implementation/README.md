# Implementation Layer

> **Agent status:** Restructured to the repository-shaped contract (review objective 46); file
> reports are seeded skeletons pending authoring.
> **Engineer verification:** Pending.

This layer answers: **how does this repository implement the specified protocol?** It is organized
around production code, not around specification paths. Traceability to the specification runs
through stable `REQ-*`/`INV-*` IDs and, downstream, exact test declarations — never through path
equality.

## Contents

- [Layer structure](#layer-structure)
- [File reports](#file-reports)
- [Directory READMEs](#directory-readmes)
- [Design views](#design-views)
- [Open questions](#open-questions)

## Layer structure

| Location | Holds |
| --- | --- |
| [source/](./source/README.md) | One maintained report per production file under `src/` and `contracts/`, mirroring the repository layout with the source extension retained (`source/src/storage/QueueStorage.ts.md`). |
| `source/**/README.md` | Per-directory subsystem ownership: shared responsibility, design, assumptions, interactions, and integration obligations of that source directory. |
| [views/](./views/) | Cross-directory design views: authored accounts of protocol flows that span several source directories (pipelines, service families, contract architecture). Views link file reports; they never duplicate or replace them, and each names its specification owner. |
| [open-questions.md](./open-questions.md) | Implementation-owned open decisions. |

## File reports

Each production file has exactly one maintained report recording: the source path and relevant
symbols; responsibility and observable boundary; inputs, outputs, state, and side effects; linked
specification requirements and planned permutations; assumptions, dependencies, trust boundaries,
limits, ordering, concurrency, failures, and recovery; current adherence, contradictions, and
missing behavior; component test obligations (`UNIT-TEST-*` with stable permutations); and related source reports.
Exact test evidence lives only in the verification test reports, mapped against those IDs.

A file may contribute to several requirements. The report describes *that file's contribution* and
must not claim complete conformance for a requirement that depends on other files — the generated
requirement view ([generated/traceability.md](../generated/traceability.md)) computes the complete
status across all contributing files.

Requirement linkage lives in each report's `Source file | Specification IDs` table; the generated
coverage report flags any production file without a report or without inventory ownership.

**Current maturity:** the reports were scaffolded from the pre-restructure subject inventories.
Seeded ID lists are coarse (whole-subject dumps) and must be narrowed to the IDs actually auditable
in each file during authoring; every `_Pending authoring_` marker is the work queue.

## Directory READMEs

A directory README owns what its files share: the subsystem's responsibility, design decisions,
internal interactions, and integration obligations (`INTEGRATION-TEST-*` cases among the files of
that subsystem). File reports stay file-scoped; anything cross-file in one directory belongs here.

## Design views

The authored deep documentation predating the restructure lives under [views/](./views/) unchanged:
pipeline accounts, RPC service reports, contract architecture, and per-topic conformance analyses.
Each view names exactly one `> **Specification subject:**` owner. Views are design narrative and
evidence context — the file report remains the single per-file account, and content still living
only in a view is migration debt to fold into the file and directory reports it covers.

## Open questions

Mechanism, conformance, and platform choices belong in
[open-questions.md](./open-questions.md); protocol behavior belongs to the specification's
register.
