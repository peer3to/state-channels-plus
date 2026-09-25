# Specification maintenance instructions

These rules apply to every file under `docs/spec/`. This file is the whole of what every task
needs; read further only where your task actually reaches:

| Before you                                      | Read                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| answer a question about specified behavior      | nothing further — the owning document, then stop              |
| edit one document inside one layer              | that layer's README                                           |
| allocate, move, or delete an ID                 | [governance.md](./governance.md)                              |
| change behavior across layers, or add a subject | [README.md](./README.md) and [governance.md](./governance.md) |
| record a decision, finding, or approval         | [governance.md](./governance.md)                              |

Reading all four entry documents before every task costs roughly four times this file for context
almost none of it uses. Follow a link when the work reaches it, not in advance.

Keep that true when editing this file. What every task must read before it starts is the one cost
paid by every task, so it is the one worth arguing about: a link is cheap, an instruction to read
something first is not. Prefer routing work to a document over requiring it in advance, and when a
document has to be read up front, say for which work.

## Agent authority

- Author and maintain specification, implementation, verification, and audit prose and mappings.
- Never infer intended behavior from current code. Raise the layer-owned open question when a decision is
  missing.
- Never mark engineer approval, edit [audit/approvals.md](./audit/approvals.md), or invoke
  `tools/approve.js`. Only explicit engineer action records approval.
- Keep future work non-normative. Keep questions separate from demonstrated findings.
- Maintained documents describe the current model. Delete obsolete or replaced IDs and update all
  maintained references in the same change; Git history is the archive.

## Allocate and link IDs safely

- Every independently allocated root ends in an immutable six-character Crockford Base32 suffix.
  Keep the semantic stem readable, then allocate it with `yarn spec:id:new <stem>`; for example,
  `yarn spec:id:new REQ-X-10`. Never choose, copy, or edit the random suffix manually.
- Planned-test (`.T<n>`) and permutation (`.P<n>`) children inherit their root suffix. Append new
  children after the highest allocated number. An ID is immutable until deletion: deleting a child
  leaves a gap, and surviving children are never renumbered or reused. Concurrent changes to that
  table must resolve the ordinary Git conflict.
- At the one canonical definition, keep the ID as unlinked inline code with its explicit anchor.
  Every other concrete ID occurrence must be a linked inline-code label pointing to that anchor.
- After changing IDs or references, run `yarn spec:ids:fix`, inspect the link changes, then run
  `yarn spec:refresh`. The refresh includes `yarn spec:ids:check` and fails on legacy IDs,
  collisions, undefined IDs, duplicate definitions or anchors, unlinked references, and wrong
  targets.

## Maintain all four layers

For every affected behavior:

1. update the neutral requirement/invariant and its planned tests in `specification/`;
2. update the changed sources' file reports: their requirement bullets (with a hand-written
   divergence line where the code departs) and their case lists;
3. update the Covers assignments in the affected `verification/tests/` reports;
4. update the current semantic/security assessment, findings, and questions in `audit/`; and
5. allow changed graph fingerprints to make affected approvals stale until an engineer reapproves.

The three layers do NOT share a filesystem structure (review objective 46). The specification is
organized by protocol system; the implementation mirrors the production tree under
`implementation/source/` (one file report per `src/`/`contracts/` file) plus cross-directory design
views under `implementation/views/`; the verification mirrors the test tree under
`verification/tests/` (one report per test file with executable declarations) plus the
tool-written `verification/requirements.md`. Traceability runs only through stable IDs and exact
test declarations — path equality is never evidence.

Every `src/`/`contracts/` file has exactly one file report at `implementation/source/<path>.md`;
its `> **Source:**` header is how the tools find it. Never clear a generated gap with a broad
directory link or a file-level ignore that hides specification evidence.

Every implementation design view explicitly names exactly one `> **Specification subject:**` owner
near its title; views link file reports and never duplicate or replace them. If concrete
documentation exposes behavior with no neutral requirement, add or amend the specification first.

Specification test plans preserve their owning requirement ID: [`INV-DA-1-TS7HX2.T1`](specification/security/data-availability.md#inv-da-1-ts7hx2.t1), with required
permutations [`INV-DA-1-TS7HX2.T1.P1`](specification/security/data-availability.md#inv-da-1-ts7hx2.t1.p1), `.P2`, and so on. Implementation tests use independent identities:
`UNIT-TEST-*` for one source file and `INTEGRATION-TEST-*` for interactions among files. Their
requirement and specification-test mappings are optional; do not force an implementation-only
behavior under an unrelated requirement. Each family is one `## <family ID>` heading: the
obligation as one sentence, `- Setup:` and `- Oracle:` bullets that state the inputs, boundaries,
failures, retries, relevant interleavings, and the observable oracle, then one bullet per case,
``- `<family ID>.P<n>` — <case>``. Exact repository test declarations map to the applicable
specification and implementation permutations in the verification layer. Number every
independently coverable implementation variation as `<UNIT-TEST-ID>.P1`…`.PN` or
`<INTEGRATION-TEST-ID>.P1`…`.PN`; never map evidence only to the parent test ID.

Every normative specification document has a compact `## Contents` menu linking every top-level section and
dedicated top-level `## Assumptions and constraints`, `## Security considerations`, and
`## Verification and test plan` sections. Keep them mechanism-specific and substantive: state exactly when the
guarantee holds, what is bounded or unsupported, which assets and trust boundaries are involved, which attacks
and residual risks remain, and the theoretical black-box/unit/integration/e2e/race/recovery/adversarial cases
with concrete oracles and explicit `none — gap` evidence. The system-level owners live in
`specification/README.md`. Never rely on scattered paragraphs to satisfy these sections.

Specification documents must contain no source links, concrete implementation status, repository
defects, concrete test evidence, or references to implementation, verification, generated, or audit
documents. Their only downstream-facing identity is the stable requirement and permutation IDs.

Each file report (`implementation/source/<path>.md`, exemplar
`implementation/source/src/disputeManager/DisputeManager.ts.md`) holds only what neither the code
nor the specification says:

- a header: `> **Source:**` (required), `> **Replaces:**` when the file takes over a removed
  source, and `> **Design views:**` linking the views that narrate its flows;
- `## Requirements`: one bullet per requirement the file contributes to, the bare ID link. A bare
  bullet means "this file contributes" and nothing more. Where the code departs from the
  requirement, add an indented hand-written line under the bullet — `Contradicts: …`,
  `Partial: …` or `Missing: …` — naming the function in backticks and linking the
  `FIND-*`/`DEF-*`/`OQ-*` that tracks it. A file that implements no specified behavior has, instead
  of this section, one line: `No specified behavior: <reason>.`;
- then its `UNIT-TEST-*` families in the format above.

A sentence that restates the code does not belong in this layer: no responsibility summaries,
design decisions, input/output lists, assumptions, or related-file lists. Do not link source line
anchors (`#L…`); name the function in backticks. Design views keep narrative prose, diagrams, and
their `INTEGRATION-TEST-*` families; a view-local requirement is a `### <ID> — <subject>` heading
with its statement and cases; a divergence no single file owns is a bullet in the view's
`## Gaps` section, in the file-report bullet shape. Cross-subsystem and E2E cases belong to
verification. If a requirement is integrator-owned or cannot be enforced generically, say so in
the divergence line.

One family, one heading. Add new cases as bullets under the family's existing heading; never
create a second heading for the same family.

The checkbox on every case bullet and the whole of `verification/requirements.md` are written by
`yarn spec:ids:fix` from the Covers cells and checked by `yarn spec:ids:check`; never type or edit
them. Write a new case unchecked as ``- `<ID>` — <case>``; the tool adds the box. `Covered` is not
a word an author writes: tested status is derived, and a requirement bullet carries no status
unless the code departs from it.

Tested status of a requirement: grep its ID in `verification/requirements.md`. Of a unit or
integration case: its checkbox in the file report or view. Which test covers a case: grep the case
ID in `verification/tests/`. Specification documents carry no test evidence.

Make every requirement, plan, and permutation reference navigable without losing its code styling:
use linked inline-code labels and stable explicit anchors at maintained definitions. Do not use line
numbers as identity anchors; formatting and nearby documentation edits make them stale.

Each test-file report (`verification/tests/<path>.md`) has: a header (test file link, Status, and
an `Exercises` link when the suite targets one production component); a short prose **Overview**
grounded in the real test bodies; and a **Tests and covered test IDs** table with one row per
declaration — the name linked to its exact line, `(line <n>)`, and a `Covers` cell listing the
**permutation IDs** that declaration covers **in full** as links to their definition anchors. The
permutation is the unit of evidence: root test IDs (`.T<n>` or bare `UNIT-TEST-*`/
`INTEGRATION-TEST-*`) name the family in the planning table and are never assignable. Judge each
permutation independently — assign every permutation the test fully satisfies (from both the
specification and implementation layers) even when sibling permutations stay unassigned; the
unassigned siblings are the tracked gap. Partial credit is never recorded; a permutation ID may
be assigned to at most one test declaration across the whole tree; one test may cover several
permutation IDs. Tests with no assigned ID stay listed with `—`. Fixtures,
harness code, utilities, runners, and configuration get no reports. Broad file links, filenames,
and adjacent tests are not evidence. Generated reports project the maintained layers; never repair
a generated table directly.

Use [verification/tests/test/unit/ValidationService.test.ts.md](./verification/tests/test/unit/ValidationService.test.ts.md)
as the canonical worked example. Do not add inventory, classification, evidence-quality, or
matrix sections: the table's Covers cells are the only mapping surface.

## Questions and findings

- Put protocol behavior, assumptions, limits, and invariants in `specification/open-questions.md`.
- Put mechanism, conformance, and platform choices in `implementation/open-questions.md`.
- Put oracle, environment, permutation, and evidence questions in `verification/open-questions.md`.
- Put residual-risk, classification, and readiness questions in `audit/open-questions.md`.
- Put known defects and omissions in `audit/open-findings.md`.
- Give one layer primary ownership and link other affected layers; do not duplicate entries.

## Tests and verification

- Specify planned tests before crediting evidence. Inspect every test body, setup, trigger, oracle, and forbidden effects.
- Unit cases exhaust normal, no-op, both boundary sides, invalid/missing state, failures, recovery/retry, and
  relevant interleavings through the real public component surface.
- System scenarios cover each materially distinct external boundary and success/failure/recovery/race or
  adversarial workflow without duplicating invisible unit permutations.
- Record evidence only in a test report's Covers cell, and only as permutation IDs the test
  covers in full — never a root test ID.
- Repair a shifted test anchor only when the declaration has one unique match. Never guess an ambiguous or
  vanished mapping.

## Change and review loop

Before implementation, identify affected IDs and resolve required engineer decisions. In the same change,
update code, mirrors, planned tests, exact test evidence, questions/findings, and audit assessment. Rerun
the narrowest mapped tests and repository gates. Reviews inspect semantic behavior and real test bodies; a
generated link is a claim, not proof.

Run `yarn spec:impact` before committing, `yarn spec:impact --staged` against the proposed commit, and
`yarn spec:impact --base <merge-base-ref>` when reviewing a PR. Semantically recheck every reported invariant
across its local specification, implementation mirrors/source, verification scenarios, and exact mapped tests.
Update the current audit with the result. Ask an engineer only when protocol intent, an oracle, or risk
acceptance is uncertain; never guess. Fingerprints automatically turn changed approved paths into
`Reverification required`; do not edit the engineer approval register.

Agents and PR/review skills must reject new structural gaps, semantic drift, incomplete test-plan/oracle coverage,
stale approvals, and unresolved blocking questions. Existing queues may remain only when the change does not
worsen them and the generated reports state them honestly.

## Engineer review state

Every maintained document under `specification/`, `implementation/`, and `verification/` (except
the tool-written `verification/requirements.md`, which nobody reviews) is pending engineer review
until the engineer records its content hash; tool-written checkboxes do not count toward the hash:
`SPEC_REVIEWER="Name" node docs/spec/tools/review.js <file...>`. Any later edit makes the
record stale automatically — the file returns to pending in
[generated/pending-review.md](./generated/pending-review.md) until re-verified. Agents never run
`review.js`; after editing any maintained file, expect it to reappear as pending/stale and say so.

## Regeneration

Run after any documentation ID/mapping/status change, source/contract addition or move, test declaration
change, question/finding change, or audit disposition change:

```bash
yarn spec:refresh
```

This command runs every generator, schema audit, and ID/link check in dependency order, formats the generated reports, and then
reruns each generator in check mode. It never authors or repairs a specification, implementation, or
verification subject. Agents must resolve each reported gap in the correct maintained layer or leave the
genuine missing behavior/evidence explicit.

`generated/` is gitignored and not committed. Run `yarn spec:refresh` locally to (re)build it, then
inspect all five files under `generated/`:

- `specification-index.md`: specification IDs that do not appear in a specification test plan;
- `implementation-coverage.md`: missing specification/implementation counterparts and unreferenced source files;
- `verification-coverage.md`: missing verification rows, exact test references, layer counterparts, and unreferenced repository tests;
- `open-questions-index.md`: unresolved questions from all four maintained layers;
- `audit-summary.md`: the joined current readiness and blocking queues.

Run `yarn spec:refresh:strict` when evaluating full completeness;
while the initial queues are being drained, its nonzero exit is expected and must match the dashboard.

Generated files are deterministic and never hand-edited. A second refresh must be byte-identical. Run
`git diff --check` before handoff.
