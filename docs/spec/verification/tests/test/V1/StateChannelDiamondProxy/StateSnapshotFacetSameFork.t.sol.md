# StateSnapshotFacetSameFork.t.sol

Test file: [test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/StateSnapshotFacetSameFork.t.sol)
Exercises: [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md)

## Overview

Three Foundry component tests pin the operands the same-fork advance reports when it rejects. Each
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

## Tests

- `test_updateStateSnapshotSameFork_submittedSnapshotOlderThanOnChain_revertsCarryingBothBlockHeights`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P12
- `test_updateStateSnapshotSameFork_proofCountDiffersFromSnapshotCount_revertsCarryingForkIdAndBothCounts`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P13
- `test_applyOutboundMessageBlocks_messageProcessingFails_revertsCarryingBothIndicesAndParticipant`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P14
- `test_updateStateSnapshotSameFork_everyMilestoneBelowChainHeight_forgedNewerSnapshot_revertsInvalidStateProof`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P33
- `test_verifyMilestones_everyMilestoneBelowThreshold_confirmsOnlyTheThresholdSnapshot`: UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P11
