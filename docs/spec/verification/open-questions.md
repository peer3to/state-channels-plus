# Verification Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved test cases, oracles, environments, permutations, and evidence sufficiency requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                               | Question                                                                            | Source                  | Affected documents                                                      | Status |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- | ------ |
| [`OQ-4-JGDCNX`](open-questions.md#oq-4-jgdcnx)   | Dispute-reduction order-independence: proof and permutation testing                 | Specification analysis  | [protocol/disputes.md](../specification/disputes/disputes.md)           | Open   |
| [`OQ-46-YWF8AM`](open-questions.md#oq-46-ywf8am) | Gas usage: component-level evidence for an unused participant and a second contract | Implementation analysis | [runtime/sdk.md](../specification/runtime/sdk.md)                       | Open   |
| [`OQ-47-8W9VT0`](open-questions.md#oq-47-8w9vt0) | Live light client evidence: no CI environment runs the peer3 node tests             | Verification analysis   | [runtime/storage-proofs.md](../specification/runtime/storage-proofs.md) | Open   |

<a id="oq-4-jgdcnx"></a>

## OQ-4-JGDCNX — Dispute-reduction order-independence

Reduction is intended to converge to the same result regardless of the order in which valid
dispute inputs are applied, even though the chain serializes transactions. The exact merge/
reduction rules and a proof that conflicting orderings cannot change the result are not yet
specified, and the property is not yet verified by permutation, adversarial, and on-chain
integration tests. Until then it MUST NOT be described as CRDT-like.

Code-derived sharpening: order independence is currently violated in principle. Killing a
commitment removes it by swap-with-last, reordering the survivor set that `reduce()` consumes
positionally, and order-sensitive consumers exist (slash application order can change the
serialized output state and therefore the successor `forkId`; the empty-timeout fold of [`OQ-14-5C8KV7` (Empty-timeout fold can suppress a real timeout)](../implementation/open-questions.md#oq-14-5c8kv7) is
last-writer-wins). Candidate directions: canonicalize (sort) the survivor set before reduction,
or prove and permutation-test independence including kills and slash-application order. See
[protocol/disputes.md](../specification/disputes/disputes.md) §5 ([`INV-DIS-5-J1QZ92` (The reduced result is independent of the order in which valid dispute inputs…)](../specification/disputes/disputes.md#inv-dis-5-j1qz92)).

<a id="oq-46-ywf8am"></a>

## OQ-46-YWF8AM — Component-level gas usage evidence

[`REQ-SDK-ARCH-6-8DE4ER.T1.P1`](../specification/runtime/sdk.md#req-sdk-arch-6-8de4er.t1.p1) (a participant that sent nothing) and [`REQ-SDK-ARCH-6-8DE4ER.T1.P5`](../specification/runtime/sdk.md#req-sdk-arch-6-8de4er.t1.p5) (one selector on
two contract addresses) keep component-level evidence on the pure table. A session has only one
manager contract, so no existing fixture can drive either through a live participant.

<a id="oq-47-8w9vt0"></a>

## OQ-47-8W9VT0 — Live light client evidence outside CI

Every Mocha file under `test/lightClient/` starts a peer3 dev node from `PEER3_NODE_BIN` and runs
only on the local runner with `--lc-tests`. Each carries `@distributed-requires: lightClient`, which no
worker protocol provides, so the distributed gate in CI leaves all of them out. The requirements whose
evidence is one of these suites, among them the live push check
[`REQ-STPROOF-3-NVJGR0.T2`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t2), count as
tested on that local evidence alone. A break on the live path (the node's push and proof format, the
Frontier digest layout, the provider's reads of pushed state) shows only when someone runs the suites by
hand. [`REQ-STPROOF-3-NVJGR0.T1`](../specification/runtime/storage-proofs.md#req-stproof-3-nvjgr0.t1)
keeps checking the proof logic in CI on recorded blocks.

Engineer decision of 2026-11-20: accepted for now. The question closes when CI runs these suites,
either through a CI job that fetches a pinned `zero-fee-node` and runs them on the local runner, or
through a runner image that carries the binary (the farm rollout of the Light Clients card).

Engineer decision of 2026-11-21: running these suites on the local runner is a named exception to
the repository rule that keeps the local runner to about ten tests. The exception ends with the farm
rollout, when the workers carry the node binary and the distributed runner runs the suites.
