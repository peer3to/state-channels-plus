# DisputeManagerFacet.sol

> **Source:** [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

## Requirements

- [`REQ-ENFDIS-1-8CSA6B` (Window bookkeeping integrity)](../../../../../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b)
- [`REQ-ENFDIS-2-VV9FPR` (Bounded participation)](../../../../../specification/enforcement/dispute-window.md#req-enfdis-2-vv9fpr)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
- [`REQ-DIS-2-PKVZ7E` (Upload is limited to eligible disputers)](../../../../../specification/disputes/disputes.md#req-dis-2-pkvz7e)
- [`REQ-DIS-3-C4KYSF` (An uploaded dispute records its commitment immediately)](../../../../../specification/disputes/disputes.md#req-dis-3-c4kysf)
- [`REQ-DIS-10-SAHJBN` (Timeout claims MUST satisfy the deadline, linkage, schedule, and existence…)](../../../../../specification/disputes/disputes.md#req-dis-10-sahjbn)
- [`REQ-LIF-4-SW8GVY` (Every initiated dispute runs through the dispute game and produces a canonical)](../../../../../specification/settlement/lifecycle.md#req-lif-4-sw8gvy)
- [`INV-TRUST-1-6TYWDH` (Every safety-relevant disagreement MUST be resolvable by the chain from…)](../../../../../specification/security/trust-model.md#inv-trust-1-6tywdh)
- [`REQ-TRUST-1-K5PS99` (Version one uses only objective, deterministic, mathematically verifiable)](../../../../../specification/security/trust-model.md#req-trust-1-k5ps99)

## UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB

Conditional admission

- Setup: Call real upload methods with signed inputs; fuzz mode and populated/empty window, holding exact component time boundaries.
- Oracle: Specific rejection leaves creation, last evidence, throttle, hasPosted and commitments unchanged.

- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P1` — true rejects an absent window in both upload modes without mutation
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P2` — true rejects a window on another fork
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P3` — true rejects a window on another channel
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P4` — true accepts before deadline in populated and empty-live windows through either upload
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P5` — true rejects at deadline without mutation
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P6` — true rejects after deadline including empty-expired windows
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P7` — true rejects a finalized window
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P8` — false preserves new-window admission
- [x] `UNIT-TEST-DISPUTE-WINDOW-ADMISSION-1-B7XWZB.P9` — false preserves fully-killed expired-window admission

## UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2

Upload bookkeeping

- Setup: Upload through every gate, boundary, reopen, and threshold-shortcut case
- Oracle: Transitions exactly per lifecycle; bounds hold; shortcut force-expires and commits the claimed output

- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P1` — auditing-flag mismatch revert
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P2` — evidence accepted at period edge
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P3` — kill refresh
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P4` — fully-killed reopen
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P5` — threshold shortcut
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P6` — throttle boundary
- [x] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P7` — auditing-hash mismatch revert
- [x] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P8` — disputer-not-sender revert
- [x] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P9` — cannot-participate revert
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P10` — already-posted revert
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P11` — timeout calldata-posted race revert
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P12` — previous-producer calldata mismatch race revert
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P13` — timeout before min-timestamp race revert
- [x] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P14` — window-created-too-early race revert
- [ ] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P15` — evidence rejected past period edge
- [x] `UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P16` — the past-deadline rejection on a populated window reverts `RaceConditionDisputeEvidencePeriodExpired` carrying the window's computed evidence-period end and the strictly later current timestamp as two distinct values
