# Specification Governance

> **Status:** Maintained policy. Engineer approval is required for normative behavior and risk acceptance.

## 1. Authority

Engineer-approved specification statements define intent. Source code records current implementation. Tests
provide evidence. Generated reports establish structural facts. None substitutes for the others.

Agents author and maintain all substantive layers, mappings, findings, and proposed dispositions. Agents must
not silently choose unresolved behavior, mark engineer approval, edit `audit/approvals.md`, or invoke
`tools/approve.js`.

## 2. Stable identities

- `REQ-<AREA>-<n>` — normative requirement.
- `INV-<AREA>-<n>` — invariant.
- `<REQ-or-INV-ID>.T<n>` — a stable planned-test row owned directly by that requirement.
- `OQ-SPEC-*`, `OQ-IMPL-*`, `OQ-VER-*`, `OQ-AUDIT-*` — new layer-owned questions.
- `DEF-*` — preserved legacy finding; `FIND-<AREA>-<n>` — new finding.

IDs are never reused. A moved or withdrawn item retains its ID and disposition. Planned tests use
simple sequential suffixes such as `INV-DA-1.T1`. Every required permutation has a stable child ID,
such as `INV-DA-1.T1.P1`; exact tests map to these permutation IDs.

Use another test-plan item (`.T2`, `.T3`) only when the requirement needs a materially different
setup, stimulus, or oracle. Variations of the same obligation are `.P1`…`.PN` under that plan item.
Do not hide several independently auditable behaviors behind one vague permutation: split them when
their coverage could differ. Number both levels contiguously and never reuse an ID for a different
behavior after it has been reviewed.

## 3. Layer contracts

### Specification

Specification documents are implementation-neutral. Each owns assumptions, dependencies, limits,
constraints, normative behavior, failures, ordering, recovery, concurrency, and adversarial behavior.

Each document starts with a compact contents menu linking every top-level section and contains dedicated
top-level assumptions/constraints, security, and verification/test-plan sections. The verification plan covers
black-box interoperability plus relevant unit/property, integration, end-to-end, boundary, failure,
retry/recovery, concurrency/race, and adversarial families with exact oracles and explicit coverage gaps. The
security section identifies protected assets, trust boundaries, threats, defenses, and residual exposure.

Every planned test states its owning requirements/invariants, setup, stimulus, exact observable
result, and exhaustive permutations or an explicit coverage rule. Each document separately records
implementation traceability and test traceability. Concrete implementation links appear only in
those non-normative traceability sections.

### Implementation

Every `src/` and `contracts/` file has exactly one mirror retaining the source extension. A mirror records its
source, protocol obligations, public/observable surface, inputs/outputs/state/side effects, assumptions,
dependencies, trust boundaries, limits, current conformance/divergence, failures/recovery/concurrency,
component test plans, implementation traceability, test traceability, exact test evidence, and related mirrors.

Every implementation test-plan row states its obligations, real public entry point and valid domain
setup, stimulus, oracle and forbidden effects, normal/no-op/boundary/invalid/failure/recovery/interleaving
variants, and exact test declarations. `Not applicable` always has a concrete rationale.

### Verification

Verification documents provide shared cross-component methodology for the test plans owned by
requirements. They state affected requirements and plan items, actors/components/external boundaries,
environments/runtime modes, setup, trigger, oracle/forbidden effects, required permutations, exact test
declarations, and open decisions without introducing another case-ID hierarchy.

Tests are mapped individually with `[test](...#L<declaration>)`; dynamic/fuzz declarations use
`[test family](...)` and enumerate generated dimensions and oracles. File and directory links map no tests.

### Audit

Audit documents contain current semantic assessment, not history. They inspect specification neutrality and
completeness, implementation conformance and unit sufficiency, system verification boundaries and oracles,
security completeness, open findings/questions, and engineer approval.

## 4. Questions, findings, and decisions

Every open question has one primary layer, owning IDs/documents, affected cross-layer links, alternatives,
blocking effect, and requested engineer decision. Cross-reference rather than duplicate. When resolved, move
the decision into its owning document with provenance, strongest rejected alternative, consequences, and
affected layers; remove it from the open register while preserving its ID.

A demonstrable defect or omission is a finding, not a question. It remains open until its owning
specification, implementation, verification, and audit path is corrected or explicitly accepted.

## 5. Approvals and staleness

The shared graph computes a normalized fingerprint for every auditable item and dependency closure. A
requirement or planned test fingerprints its complete owning document, so changes to surrounding assumptions,
constraints, security analysis, or test plans cannot leave its approval apparently current. Implementation
implementation plans also depend on linked source; every plan depends on its exact mapped test declarations. Generated output,
formatting, approval fields, timestamps, and absolute paths are excluded. Real semantic fields, source, test
declarations, mappings, planned tests, questions, and findings are included.

Only `audit/approvals.md` establishes engineer approval. An engineer invokes
`SPEC_APPROVER="Name" node docs/spec/claude/tools/approve.js <ID>`. A missing or unequal fingerprint means
`Approval pending` or `Approval stale`; dependent audit paths are stale transitively. Code review remains the
authorization boundary because repository writers can technically edit the register.

## 6. Generated analysis

All reports are projections of one shared documentation graph built from maintained docs, source, contracts,
tests, questions, findings, and approvals. Reports never generate substantive documentation.

`yarn spec:refresh` regenerates and checks all reports. It succeeds with visible completeness queues.
`yarn spec:refresh:strict` additionally fails on every unresolved structural gap, unaccounted source/test,
blocking question/finding, or absent/stale approval.

Static analysis cannot prove semantic correctness, sound oracles, conformance, or security. Agents assess
those claims; engineers approve them.

## 7. Atomic change review

Every implementation PR identifies affected IDs before changing behavior; updates specification,
implementation mirrors, planned tests, exact test mappings, questions/findings, and audit assessment in the same
change; reruns affected evidence; regenerates reports; and exposes every remaining gap. A required engineer
decision blocks implementation. A PR is not acceptable with a new or newly affected unresolved gap.

Run `yarn spec:impact` before committing to analyze the working tree, `yarn spec:impact --staged` for the
exact staged change, or `yarn spec:impact --base <merge-base-ref>` during PR review. The analyzer follows
changed specification documents, mirrors, source/contracts, planned tests, verification documents, and exact test
declarations through the shared graph and prints every requirement/invariant that must be semantically
rechecked, plus its planned tests and mapped tests. A changed `src/`, `contracts/`, or `test/` file with no path to a
requirement is a blocking traceability gap.

Agents inspect every reported path, update the maintained layers and current audit, and rerun the mapped
evidence. If the intended behavior is ambiguous, they raise the appropriate open question and ask an engineer;
they do not guess. A changed linked plan, source, or test changes its fingerprint, so the aggregate path reads
`Reverification required` automatically. Preserve the old approval record as provenance: agents never edit it
to simulate pending status. An engineer approves the reviewed final fingerprint again.

Git and the PR are the historical record. Do not add a second change-review ledger to this tree.
