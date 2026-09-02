# LeaveChannelService.ts

> **Status:** Authored implementation report.

## Source inventory

| Source file | Specification IDs |
| --- | --- |
| [LeaveChannelService.ts](../../../../../../../src/stateManager/membership/LeaveChannelService.ts) | [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay), [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9), [`REQ-DISPUTE-PIPE-7-76N72X`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x) |

## Responsibility and boundary

This service owns one terminal leave operation for a state manager. It captures the participant count and
fork at entry, sets self-removal before dispute input construction, substitutes the local leave-turn hook,
counts committed blocks, owns the local watchdog, and resolves only after local removal plus either the
settled snapshot or the on-chain reduced-fork commitment that removed the signer.
It does not author application exit calldata or dispose the outer runtime.

## State, ordering, and failure

One stored promise makes leave idempotent and gates new channel work. The first `N + 1`-block or watchdog
bound starts the existing dispute path. A dispute already active on the entry fork is awaited; after settlement,
the operation either completes if the signer is absent or rearms on the next active fork. Disposal cancels the
watchdog and rejects an unfinished operation.

## Conformance

The service covers the local state-machine part of terminal leave. Snapshot posting, dispute construction,
chain observation, port transport, and outer disposal remain with their existing owners.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| --- | --- | --- | --- |
| [`REQ-TJOIN-7-NNGTAY`](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-7-nngtay) | Covered | **Here:** one stored operation, fixed `N`, hook substitution, block and clock bounds, self-removal, dispute wait, and settled-removal completion. **Other files:** signer, host, instance, membership, snapshot, and event owners complete the route. | None. |
| [`REQ-LIF-10-QR8NQ9`](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9) | Covered | **Here:** resolution requires `SYNCED`, local absence, and either chain participant absence or an observed reduced-fork settlement carrying removal. **Other files:** snapshot posting or dispute reduction establishes the settled state; the outer instance disposes afterward. | None. |
| [`REQ-DISPUTE-PIPE-7-76N72X`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-7-76n72x) | Covered | **Here:** self-removal is set before dispute construction, and an already active dispute is awaited before next-fork retry. **Other files:** canonical inbound replay and fraud-proof validation own join-before-removal ordering; the join-race and force-join E2E reports map all three required permutations. | None. |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| --- | --- | --- | --- | --- |
| <a id="unit-test-leave-channel-service-1-cx6qh9"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9` | Terminal leave state machine | Enter through `P2pInstance.leaveChannel` or the internal signer route from every commitment state. | Hook substitution, fixed bounds, self-removal dispute input, settled removal, and one terminal disposal are exact; no cross-channel work starts. | <a id="unit-test-leave-channel-service-1-cx6qh9.p1"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P1` — immediate non-committed leave; <a id="unit-test-leave-channel-service-1-cx6qh9.p2"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P2` — authored exit; <a id="unit-test-leave-channel-service-1-cx6qh9.p3"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P3` — pending promotion; <a id="unit-test-leave-channel-service-1-cx6qh9.p4"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P4` — fixed block bound; <a id="unit-test-leave-channel-service-1-cx6qh9.p5"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P5` — zero-block watchdog; <a id="unit-test-leave-channel-service-1-cx6qh9.p6"></a>`UNIT-TEST-LEAVE-CHANNEL-SERVICE-1-CX6QH9.P6` — existing dispute wait and next-fork retry. |

## Related reports

- [MembershipService.ts](./MembershipService.ts.md)
- [StateManager.ts](../StateManager.ts.md)
- [P2pInstance.ts](../../evm/P2pInstance.ts.md)
