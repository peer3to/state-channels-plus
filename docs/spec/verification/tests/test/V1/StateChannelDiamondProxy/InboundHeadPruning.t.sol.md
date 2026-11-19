# InboundHeadPruning.t.sol

Test file: [test/V1/StateChannelDiamondProxy/InboundHeadPruning.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/InboundHeadPruning.t.sol)
Exercises: [StateSnapshotFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol.md), [DisputeVerificationFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol.md), [DisputeFraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol.md)

## Overview

A harness built from the snapshot, dispute-verification and dispute-fraud-proof facets seeds a chain
of inbound blocks with one JOIN each and clears the channel's storage the way a snapshot advance
does. On an open channel the clearing keeps the snapshot's inbound head with its height, deletes
the blocks below it and emits `ChannelStorageCleared` naming the first deleted block; a second
clearing at the same head deletes nothing and keeps it, and a clearing at a newer head deletes the kept head. On a closing channel the head is deleted too. After an open-channel
clearing, `reduce` reports the head with its real height, a dispute anchored at the head is valid
only at that height, and the historic threshold set counts no JOIN of the kept head.

## Tests

- `test_clearStorage_openChannel_keepsTheSnapshotInboundHeadAndPrunesTheBlocksBelow`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P49
- `test_clearStorage_closedChannel_prunesTheSnapshotInboundHeadToo`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P50
- `test_clearStorage_openChannel_nextPrunePrunesThePreviouslyKeptHead`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P51
- `test_clearStorage_openChannel_sameHeadTwice_keepsTheHead`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P54
- `test_clearStorage_openChannelWithoutInboundBlocks_prunesNothing`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P52
- `test_reduce_afterOpenChannelPrune_readsTheSnapshotInboundHeadHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P34
- `test_isDisputeInboundHashValid_afterOpenChannelPrune_acceptsTheSnapshotHeadAtItsHeight`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P216
- `test_historicThresholdSet_afterOpenChannelPrune_countsNoJoinOfTheKeptHead`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P217
