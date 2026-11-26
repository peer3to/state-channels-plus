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
only at that height, and the historic threshold set counts no JOIN of the kept head. The inbound reads
resolve a stored block, else the snapshot's inbound head: `reduce` and the balance-invariant check read a
missing block without reverting (height zero, zero deposits), while a snapshot update whose new inbound
head is missing reverts. The clearing also deletes a slash record of an address that already exited.

## Tests

- `test_clearStorage_openChannel_keepsTheSnapshotInboundHeadAndPrunesTheBlocksBelow`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P49
- `test_clearStorage_closedChannel_prunesTheSnapshotInboundHeadToo`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P50
- `test_clearStorage_openChannel_nextPrunePrunesThePreviouslyKeptHead`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P51
- `test_clearStorage_openChannel_sameHeadTwice_keepsTheHead`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P54
- `test_clearStorage_openChannelWithoutInboundBlocks_prunesNothing`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P52
- `test_reduce_afterOpenChannelPrune_readsTheSnapshotInboundHeadHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P34
- `test_isDisputeInboundHashValid_afterOpenChannelPrune_acceptsTheSnapshotHeadAtItsHeight`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P216
- `test_historicThresholdSet_afterOpenChannelPrune_countsNoJoinOfTheKeptHead`: UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P217
- `test_reduce_cutAboveTheSnapshotHead_readsTheStoredBlocksHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P32
- `test_reduce_snapshotHeadNotStored_readsTheSnapshotsHeight`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P39
- `test_reduce_windowOpenedInThePrunesBlock_stopsAtTheSnapshotHead`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P40
- `test_reduceAndFinalize_windowOpenedBeforeThePrune_isDeletedAndReducesNothing`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P41
- `test_reduce_withoutADisputeWindow_readsTheZeroHashAtHeightZero`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P42
- `test_reduce_cutBeforeTheFirstInboundBlock_readsTheZeroHashAtHeightZero`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P43
- `test_reduce_cutBeforeThePrunedSnapshotHeadsTime_readsThePrunedBlockAtHeightZero`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P44
- `test_verifyBalanceInvariant_storedInboundHead_readsTheBlocksDepositTotal`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P45
- `test_verifyBalanceInvariant_snapshotHeadNotStored_readsTheSnapshotsDepositTotal`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P46
- `test_verifyBalanceInvariant_missingInboundHead_answersFalseWithoutRevert`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P47
- `test_verifyBalanceInvariant_zeroInboundHead_answersFalseWithoutRevert`: UNIT-TEST-DISPUTE-VERIFICATION-FACET-1-PVCKN3.P48
- `test_applyOutboundMessageBlocks_storedNewSnapshotHead_reads`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P55
- `test_applyOutboundMessageBlocks_snapshotHeadNotStored_reads`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P56
- `test_applyOutboundMessageBlocks_missingNewSnapshotHead_reverts`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P57
- `test_applyOutboundMessageBlocks_zeroNewSnapshotHead_reverts`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P58
- `test_clearStorage_openChannel_dropsTheSlashOfAnExitedAddress`: UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P59
