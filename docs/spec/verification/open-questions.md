# Verification Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved test cases, oracles, environments, permutations, and evidence sufficiency requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                             | Question                                                            | Source                 | Affected documents                                            | Status |
| ---------------------------------------------- | ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------- | ------ |
| [`OQ-4-JGDCNX`](open-questions.md#oq-4-jgdcnx) | Dispute-reduction order-independence: proof and permutation testing | Specification analysis | [protocol/disputes.md](../specification/disputes/disputes.md) | Open   |
| [`OQ-46-YWF8AM`](open-questions.md#oq-46-ywf8am) | Gas usage: participant-level evidence for reverted sends and a second contract | Implementation analysis | [runtime/sdk.md](../specification/runtime/sdk.md) | Open |

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
[protocol/disputes.md](../specification/disputes/disputes.md) §5 ([`INV-DIS-5-J1QZ92`](../specification/disputes/disputes.md#inv-dis-5-j1qz92)).

<a id="oq-46-ywf8am"></a>

## OQ-46-YWF8AM — Participant-level gas usage evidence

[`REQ-SDK-ARCH-5-NSJYQT` (Chain spending is observable)](../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt) plans seven permutations; three of them have no
participant-level evidence. [`REQ-SDK-ARCH-5-NSJYQT.T1.P1`](../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt.t1.p1) (a participant that sent nothing),
[`REQ-SDK-ARCH-5-NSJYQT.T1.P4`](../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt.t1.p4) (a mined transaction that reverted) and [`REQ-SDK-ARCH-5-NSJYQT.T1.P5`](../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt.t1.p5) (one selector on two
contract addresses) are each covered as component behaviour on the pure table, but no existing
fixture drives them through a live participant: a session has no second manager contract, and a
deliberate on-chain revert from a peer signer would need a scenario whose own subject is a failing
chain send. The question for the engineer is whether component evidence is sufficient for these
three, or whether a participant-level fixture should be added and which one.
