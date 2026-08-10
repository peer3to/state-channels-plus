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
4. **Audit.** Check the implementation and its tests against the specification; record the evidence
   links (see [Traceability](#traceability)).

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

### 1.2 Engineer authority and agent conduct

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
  area(s), and the verification evidence (test files or suites), typically as a table at the end of
  the document ("Traceability" section).
- **Direction.** From a concept a reader can reach the relevant code; from code (via the area tags
  and links) a reader can reach the section that specifies it. Links target directories and stable
  entry points rather than line numbers wherever possible.
- **Coverage gaps are explicit.** If a requirement has no verification evidence yet, its evidence
  cell says `none — gap` (optionally with a reason). A silent empty cell is not permitted.
- **Central index.** Every ID in the tree is collected in the generated
  [traceability index](./reference/traceability-index.md) (ID → defining document → reverse
  references). Regenerate it after changing any traceability table:
  `python3 docs/spec/claude/tools/gen-traceability-index.py`. The generator fails on duplicate
  definitions and lists IDs that are mentioned but never defined.

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
- **Verification** — the strategy per the model above, with links to evidence or explicit gaps.
- **Future Work** — non-normative ideas, extensions, and questions that are not approved
  requirements. Every technical document has this section even when short.

The completion standard for any document is not a polished description of the current code. It is a
complete, unambiguous engineering specification from which a correct implementation and its tests
could be derived. Behavior that remains implicit, ambiguous, contradictory, or guessable-only from
code is surfaced as an open question for an engineer decision.

## 5. Documentation tree maintenance

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
