# Protocol Specification

> **Agent status:** Maintained.
> **Engineer verification:** Pending.

This layer defines implementation-neutral protocol behavior. It states what independently written
implementations must agree on: actors, wire/domain concepts, assumptions, constraints, invariants,
failure behavior, ordering, recovery, concurrency, and externally observable results.

## Contents

- [Required document shape](#required-document-shape)
- [Specification tree](#specification-tree)
- [System assumptions and constraints](#system-assumptions-and-constraints)
- [System security considerations](#system-security-considerations)
- [System verification and test plan](#system-verification-and-test-plan)

## Required document shape

Every normative document contains:

1. a compact contents menu linking every top-level section;
2. purpose and externally observable model;
3. terminology and normative `REQ-*` / `INV-*` statements;
4. a dedicated **Assumptions and constraints** section covering dependencies, limits, boundaries,
   and conditions under which guarantees hold;
5. a dedicated **Security considerations** section covering protected assets, trust boundaries,
   threats, defenses, abuse cases, and residual risks;
6. a dedicated **Verification and test plan** section defining every black-box test obligation,
   including setup, stimulus, expected result, required permutations, boundary combinations,
   failure/recovery/race/adversarial cases, and the coverage rule for each list; give every
   permutation a stable child ID such as `REQ-SM-1.T1.P1`;
7. failure, ordering, recovery, concurrency, and adversarial behavior;
8. a normative **Requirements and invariants** index; and
9. non-normative future work that changes protocol behavior, without describing repository tasks.

Concrete TypeScript classes, Solidity facets, storage layout, package configuration, and current
repository defects do not define normative behavior here. Unresolved protocol decisions belong in
[open-questions.md](./open-questions.md).

## Specification tree

- Architecture:
    - [Contract composition and adjudication](./architecture/contracts.md)
    - [Participant SDK and services](./architecture/sdk.md)
    - [Peer communication and RPC services](./architecture/rpc.md)
- [Concepts](./concepts/)
- Protocol mechanisms and pipelines:
    - [Protocol subjects](./protocol/)
    - [Block intake, validation, and commitment](./protocol/block-processing.md)
    - [Dispute intake, verification, and reduction](./protocol/dispute-processing.md)
- [Runtime isolation and concurrency](./runtime/execution.md)
- [Configuration semantics](./operations/configuration.md)
- [Security assumptions](./security/)
- [Neutral data types](./reference/data-types.md)
- [Open specification questions](./open-questions.md)

The local requirement and black-box test-plan tables are authoritative. For every subject `A`, read
`specification/A`, then `implementation/A`, then `verification/A`. Knowledge flows only in that
direction: a specification never links source, implementation documentation, concrete tests, or
audit state. Static analysis aggregates only this layer's requirements and planned permutations
into a generated index outside the specification layer.

## System assumptions and constraints

The complete system assumes a live, final base chain; at least one honest participant or delegated
watchtower with an honest chain view; deterministic state-machine replay; available proof and block data;
unforgeable signatures; collision-resistant commitments; and configuration windows large enough for the
deployment's chain and network conditions. Participant count, proof size, gas, latency, storage, topology,
and availability limits must be explicit in the owning documents. A guarantee does not apply outside its
stated assumptions, and an implementation must not silently introduce a stronger assumption.

The normative owner of system-wide trust assumptions and deployment limits is
[security/trust-model.md](./security/trust-model.md). Mechanism-specific documents refine those constraints
without weakening or contradicting them.

## System security considerations

The protected properties are channel funds, state integrity, finality, participant authorization, data
availability, censorship resistance within the stated timing model, and deterministic adjudication. The
primary threat classes are Byzantine participants, equivocation, invalid transitions and proofs, unavailable
data, delayed or censored messages, dishonest or lagging RPC views, replay/environment divergence, griefing,
resource exhaustion, and incorrect integration state machines.

Every mechanism document must state which assets it protects, which trust boundary it crosses, how failure
is detected and contained, and which residual risks remain. The downstream audit layer evaluates this
specification but does not redefine it.

## System verification and test plan

Verification proceeds from neutral black-box behavior to implementation-specific unit/property tests and then
to cross-component and end-to-end workflows. At system level, the required plan covers:

| Level | Required evidence |
| --- | --- |
| Interoperability | Two independent implementations given the same state, messages, signatures, chain observations, and timing inputs produce the same accepted/rejected results and commitments. |
| Component/property | Every requirement boundary, valid/invalid input, no-op, arithmetic edge, serialization property, failure, retry, and relevant interleaving is exercised through a public boundary. |
| Integration | Contract/SDK, peer/peer, RPC/chain, state-machine/protocol, persistence/recovery, and worker/runtime boundaries use real encodings and observable outcomes. |
| End to end | Opening, continuous execution, joins/top-ups, finality, snapshot advancement, withdrawal/exit, data recovery, disputes, fraud proofs, reduction, successor forks, and settlement cover success, failure, recovery, race, and adversarial paths. |
| Security | Forgery, equivocation, replay divergence, unavailable data, invalid proofs, timing edges, resource bounds, and griefing attempts fail without violating safety or corrupting durable state. |

Each owning document refines this matrix into protocol-level black-box permutations. Concrete source
conformance belongs in the matching implementation document. Exact test evidence and runtime coverage
belong in the matching verification document.
