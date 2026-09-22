# Implementation Layer

This layer answers: **which specified behavior does each production file implement, where does it
depart, and which cases must its tests cover?** It is organized around production code, not around
specification paths. Traceability to the specification runs through stable `REQ-*`/`INV-*` IDs and,
downstream, exact test declarations — never through path equality.

A sentence that restates the code does not belong here. What the code does is read from the code;
this layer records only what neither the code nor the specification says.

## Contents

- [Layer structure](#layer-structure)
- [File reports](#file-reports)
- [Test families](#test-families)
- [Design views](#design-views)
- [Tested status](#tested-status)

## Layer structure

| Location | Holds |
| --- | --- |
| `source/` | One report per production file under `src/` and `contracts/`, mirroring the repository layout with the source extension retained (`source/src/storage/QueueStorage.ts.md`). |
| [views/](./views/) | Cross-directory design views: narrative accounts of flows that span several source directories, their `INTEGRATION-TEST-*` families, and view-local requirements. Each names its specification owner. |
| [open-questions.md](./open-questions.md) | Implementation-owned open decisions: mechanism, conformance, and platform choices. |

## File reports

```markdown
# <file name>

> **Source:** [src/<path>](<relative link>)
>
> **Design views:** [<view>](<relative link>)

## Requirements

- `REQ-<AREA>-<n>-<suffix>`
- `REQ-<AREA>-<n>-<suffix>`
  Partial: <what is missing, naming the function in backticks and linking its FIND-/DEF-/OQ- entry>

## UNIT-TEST-<AREA>-<n>-<suffix>

<obligation, one sentence>

- Setup: <public entry point and valid domain setup>
- Oracle: <observable result and forbidden effects>

- [x] `UNIT-TEST-<AREA>-<n>-<suffix>.P1` — <case>
- [ ] `UNIT-TEST-<AREA>-<n>-<suffix>.P2` — <case>
```

- **Requirements.** One bullet per requirement the file contributes to, as the bare ID link. A bare
  bullet means "this file contributes" and nothing more; it never claims the requirement is
  complete. Where the code departs from the requirement, add an indented hand-written line:
  `Contradicts:`, `Partial:` or `Missing:`. Never write `Covered`.
- **No specified behavior.** A file that implements none replaces the section with one line,
  `No specified behavior: <reason>.`, and keeps any families it has. `yarn spec:impact` accounts such
  a file; a file with neither a requirement nor that line blocks it.
- **Headers.** `Source` is required: the tools find a file's report through it. `Replaces` names a
  removed source this file takes over; `Design views` points to the narrative.
- No `#L` source line anchors: they go stale on every edit. Name the function in backticks.

## Test families

Each `UNIT-TEST-*` or `INTEGRATION-TEST-*` family is one `## <family ID>` heading with its obligation,
`Setup` and `Oracle` bullets, and one bullet per independently coverable case. One family has one
heading; add new cases under it after the highest number. A reference to a case links to its
family heading. Exact test evidence lives only in the verification test reports, mapped against
the case IDs.

## Design views

Views keep narrative prose, diagrams, and `Future Work`. A view-local requirement is a
`### <REQ-or-INV-ID> — <subject>` heading followed by its statement and its case bullets
(`<ID>.T<n>.P<n>`). A divergence that no single file owns is a bullet in the view's `## Gaps`
section, in the same shape as a file report's requirement bullet.

## Tested status

Nobody types test status. `yarn spec:ids:fix` writes the checkbox on every case bullet from the
verification Covers cells, and writes each requirement's status to
[verification/requirements.md](../verification/requirements.md); `yarn spec:ids:check` fails when
either is stale.

- Tested status of a requirement: grep its ID in `verification/requirements.md`.
- Of a unit or integration case: its checkbox here.
- Which test covers a case: grep the case ID in `verification/tests/`.
