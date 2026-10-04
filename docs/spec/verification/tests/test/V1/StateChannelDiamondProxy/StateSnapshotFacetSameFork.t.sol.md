# test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol — Test Report

> **Test file:** [test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Five Foundry component tests check the same-fork advance. The first three pin the operands the same-fork advance reports when it rejects. Each
one asserts the whole decoded revert payload, and every pair of operands in a payload is given
different values, so a swapped or duplicated operand fails the test instead of passing on the
error name.

The first seeds an on-chain snapshot at block height 5 through a thin harness that inherits the
facet and submits a snapshot on the same fork at block height 3; the revert must name the on-chain
height first and the submitted height second. The second runs against the deployed diamond
(`DiamondHarness`) on a freshly opened two-participant channel and hands the advance one milestone
proof for two milestone snapshots, which no milestone chain can describe; the revert must name the
fork under advance and both lengths, which differ. The third drives the outbound-apply loop
directly and fails one message at block index 1, message index 2 — behind three messages that
succeed, so the reported pair can only be right if both loop counters are read the right way
round — and the revert must additionally name that message's participant. Its harness overrides
`_processCustomOutboundMessage`, the `internal virtual` hook an application implements for its own
outbound message types; `_processOutboundMessage` and the guard under test run as written, and a
real EXIT cannot be made to fail because the example consumer facet's `withdraw` always succeeds.

The last two drive `updateStateSnapshotSameFork` on the deployed diamond. After one legitimate
advance, a proof whose only milestone is an unsigned block below the chain height, paired with a
forged newer snapshot that names an outsider, reverts with `ErrorInvalidStateProof` and leaves the
chain snapshot unchanged: a milestone below the chain snapshot proves nothing above it. From the
fork genesis, a genesis-linked block 0 that commits a new snapshot is refused when only its author
signed it, and posted when every participant signed it (threshold-final block 0).

A proof whose only run holds the chain snapshot at its height, alone or with one author-signed block
after it, reverts `ErrorInvalidStateProof`: the start needs no threshold, so it proves nothing newer,
and the chain snapshot stays unchanged.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`test_updateStateSnapshotSameFork_submittedSnapshotOlderThanOnChain_revertsCarryingBothBlockHeights`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L83) (line 83)             | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P12`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p12)                                                                                                                                                                                                                                                                                                              |
| [`test_updateStateSnapshotSameFork_proofCountDiffersFromSnapshotCount_revertsCarryingForkIdAndBothCounts`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L112) (line 112)       | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P13`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p13)                                                                                                                                                                                                                                                                                                              |
| [`test_applyOutboundMessageBlocks_messageProcessingFails_revertsCarryingBothIndicesAndParticipant`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L138) (line 138)              | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P14`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p14)                                                                                                                                                                                                                                                                                                              |
| [`test_updateStateSnapshotSameFork_everyMilestoneBelowChainHeight_forgedNewerSnapshot_revertsInvalidStateProof`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L167) (line 167) | [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P33`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p33), [`REQ-SP-8-9PK9TS.T1.P17`](../../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t1.p17)                                                                                                                                                                                                    |
| [`test_updateStateSnapshotSameFork_proofOnlyReachingTheStart_revertsInvalidStateProof`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L187) (line 187)                          | [`REQ-SP-8-9PK9TS.T1.P28`](../../../../../specification/disputes/state-proofs.md#req-sp-8-9pk9ts.t1.p28)                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`test_updateStateSnapshotSameFork_blockZero_postsOnlyWhenFinal`](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol#L242) (line 242)                                                | [`REQ-SP-4-NCSEX4.T1.P25`](../../../../../specification/disputes/state-proofs.md#req-sp-4-ncsex4.t1.p25), [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P34`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p34), [`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P35`](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md#unit-test-state-snapshot-facet-1-vjarbb.p35) |
