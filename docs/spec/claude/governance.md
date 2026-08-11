# Specification Governance, Traceability & Verification Model

> **Status:** Draft, pending engineer approval.
> **Scope:** How this specification is owned, changed, and connected to code and tests. This
> document is meta-normative: it governs every other document in the tree.

## 1. The specification is the living source of truth

This specification is not generated documentation and not a description of the current code. It is
the primary engineering artifact for defining and evolving the system. It states intended behavior,
invariants, constraints, assumptions, trust boundaries, trade-offs, and decisions that are not
reliably implicit in implementation.

The relationship is directional:

1. **The specification defines the intended system.**
2. **Code implements that design.**
3. **Tests provide evidence that the implementation satisfies the specified behavior.**

The initial tree was reverse-engineered from the implementation, so at the start "current" and
"specified" largely coincide. From here on, they are allowed to diverge only as explicitly labelled
`Current:` / `Intended:` pairs, and every divergence is a pending decision.

### 1.1 The change loop

Every meaningful design change follows this loop:

1. **Specify.** Update the relevant specification sections and agree the change with the owning
   engineers.
2. **Implement.** Change the code to conform to the agreed specification.
3. **Verify.** Add or update tests that prove the specified requirements and invariants.
4. **Audit.** Check the implementation and its tests against the specification and update the
   current evidence links and lifecycle state (see [Traceability](#traceability)).

When code and specification disagree, the discrepancy is a decision that requires resolution — it
is never an implicit change to the source of truth. Whoever finds it (engineer or agent) records it
as an `**Open question:**` in the relevant document and in
[open-questions.md](./open-questions.md).

Classify every recorded divergence as one of four kinds, so its resolution path is obvious:

| Class                  | Meaning                                                     | Resolution                                |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| **bug**                | Current code violates an accepted requirement.              | Fix the code; add the missing test.       |
| **missing**            | The requirement is accepted but not implemented yet.        | Implement; add evidence.                  |
| **decision pending**   | The intended behavior itself is not settled.                | Engineer decides; then reclassify.        |
| **documentation debt** | Behavior exists but its contract is not yet precise enough. | Tighten the spec; no code change implied. |

A `Current:`/`Intended:` pair without a classification defaults to **decision pending** — the most
conservative reading, since implementing against an unsettled intent is guessing.

### 1.2 Atomic PR acceptance

An implementation PR is accepted only when its specification, code, tests, and documentation are a
single consistent change. The reviewer identifies every affected ID and verifies all of the
following against the actual diff and current tree:

- the specification fully describes the intended behavior and theoretical cases, with no unresolved
  question hidden by the implementation;
- the change introduces no new documentation, traceability, source-coverage, or verification gap;
- the implementation conforms to every affected normative statement, including failure, boundary,
  concurrency, and recovery behavior;
- the documented unit and e2e evidence exercises the implementation in its current form and covers
  every required observable variation;
- affected tests and repository gates were rerun and their results were inspected; and
- all links, lifecycle states, open questions, and generated artifacts are current.

Any unresolved finding blocks acceptance of an implementation PR. Git and the PR retain the review
history; the specification tree records only current truth and has no separate change-review ledger.

### 1.3 Engineer authority and agent conduct

Engineers retain decision authority over every specification change. Agents (and any automated
tooling) may propose improvements, fixes, missing requirements, and risks, but a proposal becomes
normative only after engineer approval.

An agent working against this specification MUST separate three things so an engineer can decide
with full information:

- **Observed fact** — what the code, tests, or chain actually do, with references.
- **Inferred concern** — a risk or inconsistency the agent derives, labelled as inference.
- **Proposed amendment** — the concrete specification change the agent suggests.

Agents MUST raise findings — behavior conflicting with the documented design, missing constraints,
vulnerabilities, inconsistent assumptions, insufficient verification — explicitly for engineer
review instead of silently selecting a design interpretation.

### 1.3 Decision records

When an open question is resolved, record the decision in the owning document (and mirror the
resolution in [open-questions.md](./open-questions.md)) with at least: the chosen behavior, the
date, the strongest rejected alternative when one was seriously considered, the consequence
(cost, risk, compatibility, or operational effect), and the affected layers (contracts, SDK,
wire, storage, state machine, operations, tests). Small clarifications may inline this as a dated
sentence; consequential choices use the full record. An undated normative statement whose origin
nobody can reconstruct is how specifications rot.

**Provenance is part of the record.** A decision record MUST state where the decision came from —
an engineer answering a question raised by this specification, a written source document, or a
prior approved decision. This matters because a reviewer holding only the source documents cannot
otherwise distinguish an engineer's answer from an agent's inference, and will (correctly) treat
an unsourced "Decided" label as invention. Decisions taken in a working session are legitimate and
normative; they are recorded as `engineer decision, <date>`, with the alternatives that were put
to the engineer and rejected. Evidence that merely _corroborates_ a decision — a test default, an
existing code path — is labelled as corroboration and never presented as the basis.

## 2. Traceability

<a id="traceability"></a>

Requirements and invariants that matter carry stable IDs so that specification, implementation, and
verification stay connected in both directions.

- **ID format.** `INV-<AREA>-<n>` for invariants, `REQ-<AREA>-<n>` for requirements, where
  `<AREA>` is a short domain tag (`SM` state machines, `FIN` finality, `SP` state proofs, `DIS`
  disputes, `FP` fraud proofs, `MSG` cross-layer messages, `TIME` time model, `BAL` balances,
  `CON` contracts, `SDK` SDK). IDs are never reused; a withdrawn ID is marked withdrawn, not
  recycled.
- **Where they live.** The defining document states the ID, the normative text, the implementation
  disposition, and the verification evidence, typically as a table at the end of the document
  ("Traceability" section).
- **Lifecycle state.** Each owning row declares the next unresolved gate: `Design pending` while the
  owning document is not approved; `Specified` when approved behavior has not yet had its
  implementation disposition reconciled; `Implementation missing` when approved behavior has no
  conforming linked implementation; `Verification gap` when required cases or unit/e2e evidence are incomplete;
  `Audit pending` when only the atomic PR/code review remains; and `Audited` when that review accepts
  the current specification, implementation, and tests. Static analysis validates every structural
  prerequisite but permits either final state because it cannot determine whether substantive review
  passed.
- **Implementation disposition.** Each owning row says `Current implementation:` with source links,
  `Pending implementation:` when the behavior does not exist, or `Not applicable:` with a reason for
  a process/design-only rule. When implemented behavior differs from the specification, it also says
  `Intended implementation:`, links the owning open question, and identifies the future work needed
  to converge them.
- **Verification disposition.** Each owning row has explicit `Unit:` and `E2E:` entries. Each entry
  maps every required test declaration with `[test](path/to/file#L<declaration-line>)` or states
  `Pending implementation:`, `none — gap`, or `Not applicable:` with a reason. File-only and
  directory-only links are insufficient for static test traceability.
- **Direction.** From a concept a reader can reach the relevant code; from code (via the area tags
  and links) a reader can reach the section that specifies it. Links target directories and stable
  entry points rather than line numbers wherever possible.
- **Coverage gaps are explicit.** If a requirement has no verification evidence yet, its evidence
  cell says `none — gap` (optionally with a reason). A silent empty cell is not permitted.
- **Central index.** Every ID in the tree is collected in the generated
  [traceability index](./generated/traceability-index.md) (ID → defining document → reverse
  references). Regenerate all artifacts after changing any traceability table with
  `yarn spec:refresh`. The generator fails on duplicate
  definitions and lists IDs that are mentioned but never defined.
- **Static audit.** The generated [traceability audit](./generated/traceability-audit.md) reports
  the lifecycle dashboard and state mismatches, missing implementation statuses, missing unit/e2e
  dispositions, broken local links, and automated test declarations not mapped from an owning row
  or verification specification. It also scans repository source under `src/`
  and `contracts/`: each must be directly referenced by a maintained specification document or
  explicitly classified with a rationale in
  [source-coverage.md](./generated/source-coverage.md). Directory links do not count as file
  coverage. The refresh command adds every unreferenced file as `Missing review`; agents either link
  protocol-relevant files from the owning specification or classify genuine generated,
  non-protocol, or trivial support files with a rationale. It
  also checks for the required in-depth verification matrices and heuristically flags vague linked-test names with a requirement-derived
  rename form. An unclassified source file is a specification gap until review determines whether
  its protocol behavior needs an owning specification or it is genuinely generated, non-protocol,
  or trivial support code. This is structural analysis, not a correctness proof.
- **Test accounting.** The generated [test-coverage review](./generated/test-coverage.md) maps every
  extracted test declaration to direct verification evidence. Static test declarations use
  `[test](...#L...)`; dynamic and fuzz declarations use `[test family](...#L...)` and require a plan
  that enumerates their generated permutations and expected oracles. Unmapped tests are review
  findings: update the owning verification model, including the test family and missing permutations.
  Only an entire file containing no specification verification may use
  `// @spec-test-coverage-ignore: <reason>` within its first ten lines; static analysis rejects missing
  reasons, misplaced directives, stale line anchors, and ignores made stale by a case mapping.
- **History.** Git and the PR retain historical changes and review discussion. The specification
  tree stores current truth only; it does not duplicate that history in a manually maintained ledger.

## 3. Verification model

Coverage cannot enumerate every possible state. Verification effort follows risk: the
highest-risk invariants, state transitions, trust boundaries, failure paths, and component
interactions come first.

The evidence forms a layered tree:

1. **Unit / property / invariant tests** — each component treated as a black box at its observable
   boundary, even when its implementation is available: contract checks, invariant preservation,
   adversarial and boundary inputs.
2. **Integration tests** — interactions between components: SDK manager cooperation, SDK↔contract
   flows, facet-to-facet flows.
3. **System / end-to-end tests** — whole lifecycle scenarios: open → execute → dispute → settle,
   including partitioned-network, delayed-signature, absent-participant, and adversarial cases.

Each specification document's per-section **Verification** entries say what must be tested locally,
which invariants and failure cases matter, how the component is exercised through its boundaries,
and which higher-level scenarios provide confidence in its role in the whole system. Deliberate
coverage gaps and testing assumptions are stated, not implied.

### 3.1 Dedicated verification specification

Every technical document has a full `## Verification specification` section. It specifies the tests
that ought to exist independently of whichever tests happen to exist today. A list of test-file links
alone is not a verification specification.

For every owned `REQ-*` / `INV-*`, the section defines:

- the behavior or integration boundary under test;
- setup, preconditions, and valid domain data;
- the public stimulus or workflow;
- the observable oracle: return, event, persisted state, emitted message, external effect, rejection,
  and required absence of side effects;
- meaningful equivalence partitions and both sides of every boundary;
- normal, no-op, invalid/missing-state, failure, retry/recovery, ordering, concurrency/race,
  idempotence/replay, and adversarial variations wherever the contract makes them relevant; and
- existing evidence, `Pending implementation`, `none — gap`, or a reasoned `Not applicable`.

The required unit table is:

| IDs                     | Behavior / boundary         | Preconditions                  | Stimulus           | Observable oracle                                    | Required variations                                 | Evidence / status                           |
| ----------------------- | --------------------------- | ------------------------------ | ------------------ | ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| _One or more owned IDs_ | _Public black-box behavior_ | _Valid setup and domain state_ | _Public operation_ | _Exact observable result and forbidden side effects_ | _Partitions, boundaries, failures, recovery, races_ | _Direct test links or explicit disposition_ |

The required e2e table is:

| IDs                     | Workflow / boundary               | Environment                              | Trigger                | Observable oracle              | Required variations                                   | Evidence / status                           |
| ----------------------- | --------------------------------- | ---------------------------------------- | ---------------------- | ------------------------------ | ----------------------------------------------------- | ------------------------------------------- |
| _One or more owned IDs_ | _Cross-component/system workflow_ | _Actors, chain, transport, runtime mode_ | _User/protocol action_ | _Externally observable result_ | _Success, failure, recovery, race, adversarial paths_ | _Direct test links or explicit disposition_ |

Each owned ID appears in both tables. When a layer genuinely does not apply, its row says
`Not applicable:` and explains why; absence is not a disposition.

### 3.2 Unit/component black-box depth

Unit and component tests derive from the observable contract, not private implementation details.
They exercise the component through its public surface using valid domain objects and real
collaborator boundaries according to the repository test rules. The case matrix covers every
meaningful component-level variation: happy path, no-op, both sides of boundaries, malformed or
missing state, collaborator failure, retry/recovery, relevant interleavings, and required negative
effects. Internal branches are not themselves specification cases unless they produce distinct
observable behavior.

Each case has a precise oracle. “Does not throw,” “works,” or an implementation method being called
is insufficient unless that is the complete public guarantee. The oracle states the resulting value,
state transition, emitted event/message, durable side effect, error classification, and anything that
must remain unchanged.

### 3.3 Integration and end-to-end depth

Integration/e2e scenarios validate the implementation at every materially affected boundary:
SDK↔contract, peer↔peer, runtime/worker ports, persistence/restart, transport, chain events, or other
external systems as applicable. They cover representative complete workflows and every variation
that changes observable system behavior: success, rejection/failure, recovery/retry, concurrency or
race ordering, adversarial input, and relevant runtime/platform modes. They do not duplicate unit
permutations that are observationally identical at system level.

A code or PR review contains a dedicated verification assessment that compares the implementation
diff with this theoretical matrix, checks the linked tests rather than trusting their names, records
the exact reruns and environment, and identifies missing cases. Reviewers propose concrete,
behavior-oriented replacements for unclear test file or case names.

### 3.4 Test naming

Test names state the condition/action and observable outcome. Prefer names such as “rejects a second
commitment from the same participant without mutating the first” over “handles duplicates” or
“works correctly.” Suite/file names identify the component or workflow. A misleading or overly broad
name is a review finding even when the assertion is correct; the review suggests a concrete rename
that matches the actual setup and oracle.

Current test entry points: [test/](../../../test) (unit/integration and e2e suites; see
[reference/configuration.md](./reference/configuration.md) for the commands and the parallel and
distributed runners).

## 4. Section template

<a id="section-template"></a>

Every system, subsystem, and component section in this tree includes, at a depth proportional to
its risk and complexity:

- **Purpose & observable contract** — what it does, its inputs/outputs, what it guarantees and
  what it explicitly does not guarantee.
- **Assumptions, constraints & dependencies** — the operating conditions under which the design is
  correct, the boundaries it must not cross, and what it relies on.
- **Invariants & failure behavior** — with IDs where they matter, plus ordering/concurrency rules
  and recovery behavior where relevant.
- **Verification specification** — the dedicated black-box unit and integration/e2e matrices from
  §3, including theoretical cases, exact oracles, required variations, links to evidence, and
  explicit gaps.
- **Future Work** — non-normative ideas, extensions, and questions that are not approved
  requirements. Every technical document has this section even when short.

The completion standard for any document is not a polished description of the current code. It is a
complete, unambiguous engineering specification from which a correct implementation and its tests
could be derived. Behavior that remains implicit, ambiguous, contradictory, or guessable-only from
code is surfaced as an open question for an engineer decision.

## 5. Documentation tree maintenance

- Agents editing this tree follow the operational checklist in [AGENTS.md](./AGENTS.md), including
  the generated-artifact triggers, code/test cross-reference rules, and pre-handoff validation.
- References resolve only to repository-available documentation, source, contracts, scripts, tests,
  and other tracked project files. Ignored/private generation artifacts and unavailable external inputs
  are not specification provenance; carry their durable conclusions into the owning document,
  open-question register, or decision record.
- The tree mirrors stable implementation boundaries (architectural domains), not individual files,
  to avoid churn from routine refactors.
- The root [README.md](./README.md) keeps the book-like, top-to-bottom overview for onboarding; the
  tree is the authoritative maintainable reference. Both must stay consistent — the root links
  down, documents link back up and sideways.
- Every document begins with a `Status:` line (`Draft`, `In review`, `Approved`, plus date or
  reviewer when known). Only `Approved` content is binding under §1.

## Future Work

_Non-normative._

- Tooling that lints traceability tables beyond the index generator: evidence paths exist, no
  silent gaps, code links resolve.
- CI enforcement that a PR touching a specified area either updates the spec or states why not,
  and that the generated traceability index is up to date.
