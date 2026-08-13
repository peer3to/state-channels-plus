# State Channels Plus Specification

> **Status:** Reverse-engineered baseline under agent maintenance and engineer review.
> **Authority:** Engineer-approved normative statements define intended behavior. Current code is evidence,
> not authority.

This tree is the durable specification, implementation account, verification plan, and current audit for
State Channels Plus. It is written for protocol reviewers, SDK and contract implementers, test authors,
security reviewers, and agents maintaining the cross-references.

## 1. System overview

State Channels Plus lets a small group execute a deterministic application state machine through signed
peer-to-peer blocks while using a base chain for escrow, ordered cross-layer messages, public evidence,
objective fault enforcement, recovery, snapshot adoption, and settlement.

The integrator supplies deterministic state transition, participant ordering, balance algebra, inbound
processing, and outbound effects. The SDK forms and validates blocks, collects signatures, manages proofs,
stores evidence, and orchestrates recovery. The manager contract stores the adopted snapshot, message
progress, dispute windows, slash state, and reduced successor forks.

Normal progress is off-chain. Unanimous direct or virtual signer coverage establishes finality. Deposits and
joins enter through an inbound hash chain; withdrawals and exits leave through an outbound hash chain.
Objective faults use fraud proofs. Liveness or availability failures enter a dispute/reduction flow that
selects proved history and creates a mandatory successor fork.

## 2. Four primary layers

| Layer | Question answered | Maintained contents |
| --- | --- | --- |
| [Specification](./specification/README.md) | What must every conforming implementation do, and what must be tested? | Neutral requirements/invariants, assumptions, limits, security model, and exhaustive black-box test plans. |
| [Implementation](./implementation/README.md) | How does this repository implement those rules? | Repository-shaped: one file report per production source file under `implementation/source/`, directory READMEs for subsystem ownership, and cross-directory design views. |
| [Verification](./verification/README.md) | How are the real tests judged? | Repository-shaped: one report per test file under `verification/tests/` with per-declaration level classification, plus level indexes and methodology views. |
| [Audit](./audit/README.md) | Is the complete system structurally complete, semantically correct, sufficiently tested, and approved? | Current specification, implementation, verification, and security assessments; findings; questions; and engineer approvals. |

The three layers answer different questions and deliberately do NOT share one filesystem structure
(review objective 46). The specification is organized by protocol system; the implementation
mirrors `src/` and `contracts/`; the verification mirrors `test/`. Their relationship is carried by
stable identities — `REQ-*`/`INV-*`, planned-test permutations, `UNIT-TEST-*`/`INTEGRATION-TEST-*`,
source paths, and exact test declarations — joined in the generated
[traceability views](./generated/traceability.md). For example, the state-machine account is:

```text
specification/protocol-model/state-machines.md        (neutral rules, REQ-SM-*)
    -> implementation/source/contracts/V1/AStateMachine.sol.md   (file report linking REQ-SM-*)
        -> verification/tests/test/... reports mapping REQ-SM-*.T*.P* to exact declarations
```

Knowledge flows only from left to right:

- **Specification** exists before any particular implementation. It contains requirements and invariants,
  assumptions and constraints, security consequences, and numbered black-box test-plan permutations. It
  never cites this repository's source or tests.
- **Implementation** is authored after source exists. One report per production file explains that
  file's responsibility, conformance, and divergences and links its requirements by ID; directory
  READMEs own subsystem-shared design and integration cases; design views narrate cross-directory
  flows. It may cite the specification, but not concrete test evidence.
- **Verification** is authored after tests exist. One report per test file inspects the actual test
  bodies, classifies each declaration (unit/integration/system/end-to-end), and judges whether it
  proves its assigned permutations. It owns all exact test-declaration links and records good,
  partial, misleading/adjacent, and missing evidence.

Follow the IDs — via the generated traceability views — for the full picture of any behavior. A later layer may refine or expose a gap in an
earlier one, but it may not silently redefine it.

Supporting infrastructure:

- [Governance](./governance.md) defines IDs, ownership, approval, change, and acceptance rules.
- [AGENTS.md](./AGENTS.md) is the mandatory maintenance checklist for agents.
- `tools/` contains structural analyzers and approval tooling.
- `generated/` contains deterministic inverse inventories and the current dashboard.

## 3. Authored documents and generated review workspace

Agents author the three subject documents by reading, in order, the neutral design, the real source, and the
real tests. The generators do **not** write those documents or infer their semantic claims. They parse the
maintained IDs and links, compare them with the repository, and produce inverse inventories under
`generated/` so omissions remain visible.

Generated files contain current structural facts only and are never hand-edited:

| Generated file | Meaning |
| --- | --- |
| [Specification index](./generated/specification-index.md) | Specification IDs that do not appear in any specification test plan, with a link to the specification that defines each ID. |
| [Implementation coverage](./generated/implementation-coverage.md) | Design views without declared specification owners, source files without file reports, and source files no inventory references. |
| [Verification coverage](./generated/verification-coverage.md) | Permutations without traceability rows, planned tests without exact repository-test references, test files without test reports, and repository tests that verification does not reference. |
| [Traceability views](./generated/traceability.md) | Inverse joins: requirement → production files and mapped tests; production file → requirements and report; mapped declaration → level and permutations; protocol system → evidence rollup. |
| [Open-question index](./generated/open-questions-index.md) | Unresolved questions from the specification, implementation, verification, and audit question registers. |
| [Audit summary](./generated/audit-summary.md) | Compact requirement readiness with direct links to the authoritative specification, implementation, and verification rows, plus structural, semantic, security, and final status. |

Run all generators and schema checks together:

```bash
yarn spec:refresh
```

Run it after changing a requirement, planned permutation, source inventory/report, implementation test plan,
verification mapping, test declaration, open question, finding, or audit state. Review all five generated
files; a successful refresh means the documents are parseable and the reports are deterministic, not that
the system is complete. Run the command a second time when changing the generators and confirm it produces no
further diff. Never hand-edit `generated/`.

Before committing, deterministically list every requirement path affected by the working tree or staged
change:

```bash
yarn spec:impact
yarn spec:impact --staged
```

During PR review, compare the branch with its merge-base ref:

```bash
yarn spec:impact --base origin/main
```

The impact analyzer prints the invariants requiring semantic rechecking, their specification/implementation/
planned tests, mapped tests, and current aggregate approval. Unmapped changed source or test files block
the review. Linked changes invalidate approval fingerprints automatically; agents preserve the approval record
and engineers reapprove the final reviewed fingerprint.

This command succeeds when generation is deterministic and maintained schemas are parseable, while leaving
known queues visible. The completeness gate is:

```bash
yarn spec:refresh:strict
```

It fails while mirrors, test plans, mappings, links, decisions, findings, or current approvals remain incomplete.

## 4. Subject document shapes

Every specification subject contains a contents menu, the neutral observable model, requirements/invariants,
assumptions and constraints, security considerations, and a verification/test plan. Each planned test keeps
the requirement identity (`REQ-X-1.T1`) and enumerates independently checkable permutations
(`REQ-X-1.T1.P1` … `.PN`).

Every implementation subject contains, in order, an implementation overview, assumptions and constraints,
system design, system integration test plan, source inventory with one source report and unit-test plan per
file, and conformance traceability. Implementation cases use `INTEGRATION-TEST-*` and `UNIT-TEST-*`, each with
explicit `.P1` … `.PN` permutations.

Every verification subject contains only a verification overview followed by specification-test traceability
and implementation-test traceability. Analysis belongs in those rows: exact test declaration, runtime,
quality of its setup/oracle, and the precise missing portion. There is no separate consolidated inventory or
strategy section that can drift from the two matrices.

The state-machine triplet is the canonical worked example. Layer READMEs define the complete schemas.

Architecture is specified as behavior too. Contract composition, participant-service ownership, peer RPC
and each service family, block validation/commitment, dispute audit/reduction, runtime isolation, and
configuration semantics have neutral specification subjects with matching implementation and verification
documents. Detailed concrete reports name exactly one specification owner; static analysis rejects an
implementation document that has none.

## 5. Traceability path

The intended path for every normative behavior is:

```text
REQ-* / INV-*
    -> planned test items such as INV-SM-1.T1
    -> implementation traceability
    -> test traceability for every required permutation
    -> exact automated test declarations
    -> current audit assessment and engineer approval
```

Every test declaration maps to at least one planned-test item. A test-file link is not evidence.
Dynamic/fuzz declarations use `[test family](...#L...)` and document their dimensions and oracles.
A genuinely out-of-scope test file may use
`// @spec-test-coverage-ignore: <reason>` in its first ten lines.

## 6. Open questions and findings

Each primary layer owns its own decision register:

- [Specification questions](./specification/open-questions.md)
- [Implementation questions](./implementation/open-questions.md)
- [Verification questions](./verification/open-questions.md)
- [Audit questions](./audit/open-questions.md)

A question has one primary owner and cross-links other affected layers. Existing `OQ-*` IDs are preserved;
new IDs use `OQ-SPEC-*`, `OQ-IMPL-*`, `OQ-VER-*`, or `OQ-AUDIT-*`. Demonstrated defects are findings, not
questions: existing `DEF-*` IDs remain in [open findings](./audit/open-findings.md), while new findings use
`FIND-<AREA>-<n>`.

## 7. Usage guide — engineer vs agent

The tree has two actors with strictly separated authority. Everything below is enforceable: the
generated reports expose violations, and the two approval registers cannot be legitimately written
by agents.

### What the engineer does

1. **Review documents.** [generated/pending-review.md](./generated/pending-review.md) is the
   burn-down list: every maintained document under `specification/`, `implementation/`, and
   `verification/` is *pending* until you record its content hash:

   ```bash
   SPEC_REVIEWER="Name" node docs/spec/claude/tools/review.js <file...>
   ```

   The register is [audit/review-state.json](./audit/review-state.json). Any later edit to a
   verified file changes its hash, and the next refresh automatically moves it to **stale** (your
   old review is shown but no longer counts) — nobody has to remember to re-flag it. Re-review the
   diff and re-run `review.js`.
2. **Decide open questions.** [generated/open-questions-index.md](./generated/open-questions-index.md)
   lists every unresolved decision. Agents must not choose protocol behavior; each `OQ-*` blocks
   whatever it names until you resolve it (the resolution then moves into the owning document).
3. **Disposition findings.** [audit/open-findings.md](./audit/open-findings.md) holds demonstrated
   defects (`DEF-*`/`FIND-*`); confirm the proposed direction or reject it, then the fix proceeds
   as a normal change.
4. **Approve requirements.** Separate from document review, at a different granularity with a
   different staleness trigger:

   ```bash
   SPEC_APPROVER="Name" node docs/spec/claude/tools/approve.js <REQ-or-INV-ID>
   ```

   recorded in [audit/approvals.md](./audit/approvals.md), surfaced per requirement path in
   [generated/audit-summary.md](./generated/audit-summary.md).

   | | Document review (`review.js`) | Requirement approval (`approve.js`) |
   | --- | --- | --- |
   | Unit | one markdown file | one `REQ-*`/`INV-*` ID |
   | Hash covers | that file's bytes | the dependency closure: the requirement's complete owning specification document, the linked implementation evidence *and its source files*, and the exact mapped test declarations' code |
   | Invalidated by | editing that file | editing anything in the closure — including a `src/` or `test/` change that touches no document |
   | You are saying | "I read this document and its account is accurate" | "this behavior is correctly specified, the implementation conforms, and the mapped tests prove it" |

   The systems fail independently in both directions: a perfectly written file report can belong to
   a requirement with no test evidence yet, and a fully proven requirement can sit in a document
   with a stale paragraph. A code refactor silently invalidates approvals (closure hash) without
   touching reviews; a doc rewording invalidates reviews without necessarily touching semantics.
   Intended sequence: document review is the cheap reading pass done early; requirement approval is
   the per-behavior final sign-off done as test evidence lands. Cosmetic churn (formatting,
   generated output, the approval fields themselves) is excluded from fingerprints; semantic
   fields, source bytes, and test bytes are included, and dependents go stale transitively.
5. **Gate releases.** `yarn spec:refresh:strict` fails while anything is pending/stale/unmapped —
   the checkable definition of "the documentation is complete and reviewed".

### What the agent does

1. **Author and maintain everything** — specification subjects, implementation file reports and
   views, verification test reports, findings, questions, and the current audit — always leaving
   honest gaps (`none — gap`, `Pending inspection`) rather than paper-over claims.
2. **Follow the change loop** (§8): before changing behavior, identify affected IDs via
   `yarn spec:impact`; update specification first when neutral behavior changes; update the
   affected file reports, test reports, and audit state in the same change; run
   `yarn spec:refresh` and leave every generated gap visible.
3. **Never mark approval or review.** Agents do not run `review.js` or `approve.js`, and do not
   edit `review-state.json` or `approvals.md`. After editing any maintained file, the agent expects
   it to reappear as pending/stale and says so.
4. **Never decide open questions.** When intended behavior is ambiguous, raise the layer-owned
   `OQ-*` and stop at the documented divergence (`Contradicts` rows, three-way
   adherence/contradictions/missing sections) instead of normalizing either side.
5. **Keep traceability real.** IDs are linked to their definition anchors; a test counts only as an
   exact inspected declaration mapped to the permutation it proves; path equality is never
   evidence.

### Reading paths

- *Understand a behavior:* start at the system README (specification), follow the owned document,
  then jump by ID through [generated/traceability.md](./generated/traceability.md) to the file
  reports and test evidence.
- *Understand a source file:* open its report under `implementation/source/<path>.md` — boundary,
  key design decisions, linked requirements, conformance with Here/Other-files evidence, and its
  `UNIT-TEST-*` obligations.
- *Judge test coverage:* `verification/tests/<path>.md` per file, level indexes for the normalized
  view, and the verification-coverage report for the queue.

## 8. Change and review workflow

For a design, implementation, contract, or test change affecting specified behavior:

1. identify affected requirements, planned tests, mirrors, scenarios, questions, findings, and approvals;
2. update or raise the neutral specification decision before choosing behavior;
3. update the implementation subject's overview, design, source reports, unit/integration plans, and
   conformance rows;
4. inspect real test bodies and update both verification traceability matrices with exact declaration links
   and honest coverage classifications;
5. run affected tests, `yarn spec:refresh`, and inspect all generated gaps;
6. reset or allow fingerprints to invalidate affected approvals; and
7. audit the complete path and obtain explicit engineer approval before acceptance.

An agent authors and checks documentation but cannot resolve an engineer decision or write an approval.
Approvals are recorded only through the engineer workflow in [audit/README.md](./audit/README.md).

## 9. Current maturity

The four-layer structure and analyzers are being established from a reverse-engineered baseline. Non-strict
generation is expected to expose missing subject mirrors or source owners, incomplete test plans, unaccounted tests, open decisions,
and pending approvals. Those queues are the work list; they must not be hidden or mass-approved. The strict gate
becomes green only after domain-by-domain agent authorship and engineer verification are complete.
