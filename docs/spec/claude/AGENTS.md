# Specification maintenance instructions

These rules apply to every file under `docs/spec/claude/`. Read [README.md](./README.md) and
[governance.md](./governance.md), then the owning layer README and directly linked documents.

## Agent authority

- Author and maintain specification, implementation, verification, and audit prose and mappings.
- Never infer intended behavior from current code. Raise the layer-owned open question when a decision is
  missing.
- Never mark engineer approval, edit [audit/approvals.md](./audit/approvals.md), or invoke
  `tools/approve.js`. Only explicit engineer action records approval.
- Keep future work non-normative. Keep questions separate from demonstrated findings.
- Preserve all stable `REQ-*`, `INV-*`, planned-test, `OQ-*`, and `DEF-*` IDs; never renumber on move.

## Maintain all four layers

For every affected behavior:

1. update the neutral requirement/invariant and its planned tests in `specification/`;
2. update the matching implementation subject's exhaustive source inventory, design analysis,
   implementation-specific test obligations, and conformance traceability;
3. update the matching verification subject's specification-test and implementation-test traceability;
4. update the current semantic/security assessment, findings, and questions in `audit/`; and
5. allow changed graph fingerprints to make affected approvals stale until an engineer reapproves.

Every `src/`/`contracts/` file appears in at least one implementation subject inventory. Every
specification subject has the same relative path in `implementation/` and `verification/`. Every
extracted test declaration maps at least once to a planned-test permutation. Never clear a generated gap with a broad directory link,
an unexplained `Not applicable`, or a file-level ignore that hides specification evidence.

Every implementation document is either the matching primary subject or explicitly names exactly one
`Specification subject` owner near its title. Detailed architecture, service, pipeline, runtime, example,
and operations reports are concrete children of that neutral owner; they are never free-standing design
authority. If concrete documentation exposes behavior with no neutral requirement, add or amend the
specification first, then its matching implementation and verification subjects.

Specification test plans preserve their owning requirement ID: `INV-DA-1.T1`, with required
permutations `INV-DA-1.T1.P1`, `.P2`, and so on. Implementation tests use independent identities:
`UNIT-TEST-*` for one inventoried source file and `INTEGRATION-TEST-*` for interactions among the
files of one subsystem. Their requirement and specification-test mappings are optional; do not
force an implementation-only behavior under an unrelated requirement. Each row states all inputs,
boundaries, failures, retries, relevant interleavings, and the observable oracle. Exact repository
test declarations map to the applicable specification and implementation permutations in the
verification layer. Number every independently coverable implementation variation as
`<UNIT-TEST-ID>.P1`…`.PN` or `<INTEGRATION-TEST-ID>.P1`…`.PN`; never map evidence only to the
parent test ID.

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

Each matching implementation document owns `## Implementation overview`, `## Assumptions and constraints`,
`## System design`, one `## System integration test plan`, a two-column
`## Source inventory` (`Source file | Specification IDs`), and bottom
`## Conformance traceability`, in that order. The overview has a `Status` field and dedicated
`### Specification adherence`, `### Specification contradiction`, and `### Missing` subsections.
It distinguishes contradiction from missing implementation and states each required resolution
beside its issue; never duplicate the issues in a separate remaining-work list. The assumptions section defines the
conditions and limits under which the concrete implementation operates. Inventory only files
where the listed IDs can actually be audited; do not add generic role/status columns or repeat
symbol dumps.

Use this top-down order so readers see the implemented system and its interaction guarantees
before descending into individual files. Nest every inventory item in the contents menu and give it one matching
`### Source report: <filename>` section. Each report links the exact source, lists the IDs actually
auditable there, explains that file's responsibility, design decisions, assumptions and constraints,
and contains an exhaustive `#### Unit tests` table for that file's public boundary. Give every row a
stable `UNIT-TEST-*` ID. Give every internal system-composition case above the inventory a stable
`INTEGRATION-TEST-*` ID. Do not define cross-subsystem or E2E
cases in implementation documents; verification owns those. Link conformance evidence to the
narrowest relevant source line (`#L…`). If a requirement is integrator-owned or cannot be enforced
generically, say so.

Make every requirement, plan, and permutation reference navigable without losing its code styling:
use linked inline-code labels and stable explicit anchors at maintained definitions. Do not use line
numbers as identity anchors; formatting and nearby documentation edits make them stale.

Each matching verification document owns `## Verification overview` and bottom
`## Specification test traceability` plus `## Implementation test traceability`.
Do not add an upstream-dependency section: the mirrored subject already defines its specification
and implementation inputs. The overview has a `Status` field and dedicated
`### Specification-test adherence`, `### Implementation-test adherence`, `### Contradictions`, and
`### Missing` subsections. Inspect the real test body for every traceability row and state whether its
setup and oracle give good, partial, wrong/misleading, adjacent-only, or missing coverage, with a
specific explanation. One declaration may appear in multiple rows when it genuinely covers multiple
cases; the case is the unit of traceability. Broad file links, filenames, and adjacent tests are not
evidence. Exact test links exist only here. Generated reports project these maintained layers; never
repair a generated table directly.

Use [verification/concepts/state-machines.md](./verification/concepts/state-machines.md) as the canonical
worked example. Do not add `Upstream dependencies`, `Test declaration inventory`, `Combined verification
strategy`, or `Consolidated test evidence`: they duplicate information owned by the mirrored path and the two
traceability matrices. Put the coverage judgment beside the case it evaluates.

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
- Link static declarations as `[test](...#L<declaration>)`; link dynamic/fuzz declarations as
  `[test family](...)` and enumerate dimensions and oracles.
- Use `node docs/spec/claude/tools/audit-test-coverage.js --fix` only to repair a uniquely matched shifted
  anchor. Never guess an ambiguous or vanished mapping.

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

## Regeneration

Run after any documentation ID/mapping/status change, source/contract addition or move, test declaration
change, question/finding change, or audit disposition change:

```bash
yarn spec:refresh
```

This command runs every generator and schema audit in dependency order, formats the six reports, and then
reruns each generator in check mode. It never authors or repairs a specification, implementation, or
verification subject. Agents must resolve each reported gap in the correct maintained layer or leave the
genuine missing behavior/evidence explicit.

Inspect all six files under `generated/`:

- `specification-index.md`: requirements and planned permutations missing or malformed in neutral specs;
- `implementation-coverage.md`: unowned source, missing source reports/test plans, and conformance gaps;
- `test-coverage.md`: real test declarations without an exact planned-case owner;
- `verification-coverage.md`: planned specification/implementation permutations without adequate evidence;
- `open-questions-index.md`: unresolved decisions and malformed ownership;
- `audit-summary.md`: the joined current readiness and blocking queues.

Run `yarn spec:refresh:strict` when evaluating full completeness;
while the initial queues are being drained, its nonzero exit is expected and must match the dashboard.

Generated files are deterministic and never hand-edited. A second refresh must be byte-identical. Run
`git diff --check` before handoff.
