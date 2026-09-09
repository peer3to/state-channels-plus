# Verification Open Questions

> **Status:** Maintained current register.
> **Scope:** Unresolved test cases, oracles, environments, permutations, and evidence sufficiency requiring engineer decisions.

Every question has one primary layer. Cross-layer effects remain links rather than duplicate entries.
Existing `OQ-*` IDs are preserved; new questions use the layer-scoped namespace documented in governance.

## Index

| ID                                                                                         | Question                                                                        | Source                 | Affected documents                                                                                                                                                                                                                                                                                                                  | Status |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`OQ-4-JGDCNX`](open-questions.md#oq-4-jgdcnx)                                             | Dispute-reduction order-independence: proof and permutation testing             | Specification analysis | [protocol/disputes.md](../specification/disputes/disputes.md)                                                                                                                                                                                                                                                                       | Open   |
| [`OQ-VER-PERMUTATION-SPLIT-1-GBB0NX`](open-questions.md#oq-ver-permutation-split-1-gbb0nx) | Three compound permutations cannot be owned in full by any one test declaration | Verification analysis  | [source/src/P2PManager.ts.md](../implementation/source/src/P2PManager.ts.md), [source/src/rpc/services/lobbyMatching/LobbyMatchingService.ts.md](../implementation/source/src/rpc/services/lobbyMatching/LobbyMatchingService.ts.md), [peer-communication/lobby-matching.md](../specification/peer-communication/lobby-matching.md) | Open   |

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
serialized output state and therefore the successor `forkId`; the empty-timeout fold of [`OQ-14-5C8KV7`](../implementation/open-questions.md#oq-14-5c8kv7) is
last-writer-wins). Candidate directions: canonicalize (sort) the survivor set before reduction,
or prove and permutation-test independence including kills and slash-application order. See
[protocol/disputes.md](../specification/disputes/disputes.md) §5 ([`INV-DIS-5-J1QZ92`](../specification/disputes/disputes.md#inv-dis-5-j1qz92)).

<a id="oq-ver-permutation-split-1-gbb0nx"></a>

## OQ-VER-PERMUTATION-SPLIT-1-GBB0NX — Compound permutations with no single owning declaration

A permutation is the unit of evidence: it is credited only to a declaration that covers it in full,
and to at most one. Three permutations bundle two independently coverable behaviors, so every
behavior is demonstrated in the repository while the ID itself stays unassigned.

- [`UNIT-TEST-LOBBY-MATCHING-1-SMZVNB.P9`](../implementation/source/src/rpc/services/lobbyMatching/LobbyMatchingService.ts.md#unit-test-lobby-matching-1-smzvnb.p9)
  bundles the reconnect ban on a non-selected candidate at commitment handoff with the cleanup
  order (leave the topic, then close the transports and lift the bans). Two declarations in
  [LobbyMatchingService.test.ts](tests/test/rpc/lobbyMatching/LobbyMatchingService.test.ts.md)
  cover one behavior each.
- [`REQ-LOBBY-9-N894C0.T1.P12`](../specification/peer-communication/lobby-matching.md#req-lobby-9-n894c0.t1.p12)
  bundles two suspended-peer subjects: a non-selected candidate, proven end-to-end in
  [E2E-LobbyMatching.test.ts](tests/test/e2e/E2E-LobbyMatching.test.ts.md) including the
  refused-at-admission absence oracle, and a peer past the ignored-traffic bound, proven at unit
  level where no dial happens at all.
- [`UNIT-TEST-P2P-MANAGER-2-HR5HCB.P4`](../implementation/source/src/P2PManager.ts.md#unit-test-p2p-manager-2-hr5hcb.p4)
  bundles the joined-key bookkeeping, which
  [P2PManager.test.ts](tests/test/P2PManager.test.ts.md) proves, with a duplicate join and a
  rejected invalid key, which no declaration exercises.

Decision needed: split the first two into one permutation per behavior so each gains an owner, or
extend one declaration in each pair to cover the whole text. For the third, either extend the
joined-key case with a duplicate join and a malformed key, or drop that clause from the
permutation. Agents must not renumber or edit these definitions without the engineer's direction,
since the IDs are immutable until deletion.
