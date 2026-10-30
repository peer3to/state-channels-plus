# FraudProofFacetWrongGenesisPastGenesis.t.sol

Test file: [test/V1/StateChannelDiamondProxy/FraudProofFacetWrongGenesisPastGenesis.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacetWrongGenesisPastGenesis.t.sol)
Exercises: [FraudProofFacet.sol](../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol.md)

## Overview

A Foundry suite on the deployed, routed diamond (`DiamondHarness.deployDiamond()`). `setUp` opens a
two-participant channel and keeps its genesis snapshot. Each case submits a WrongGenesis proof for
a block 0 that the author signed on the genesis fork, and checks the slash set through
`isParticipantSlashedOnChain` for the author, the eligible participant and an outsider.

While the on-chain snapshot is still the genesis, an unlinked block 0 slashes its author, and a
linked one goes on to the origin window, which an opened channel's genesis has none of, and reverts
`RaceConditionDisputeWindowNotOpen`. After a same-fork adoption through
`updateStateSnapshotSameFork` moves the snapshot to height 1, the chain no longer holds the genesis:
an unlinked block 0 from an eligible submitter and a linked one from an outsider both revert
`RaceConditionBlockHeightTooOld(1, 0)` with the exact payload, and nobody is slashed. One fuzz case
spans any previous-block hash with either submitter past genesis: always refused, nobody slashed.

## Tests

- `test_applyFraudProofs_unlinkedBlockZeroAtGenesis_slashesAuthor`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P33
- `test_applyFraudProofs_linkedBlockZeroAtGenesis_revertsAndSlashesNobody`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P34
- `test_applyFraudProofs_unlinkedBlockZeroPastGenesis_revertsAndSlashesNobody`: INV-ENFFP-1-BGVZN4.T1.P21, UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P35
- `test_applyFraudProofs_linkedBlockZeroPastGenesisFromOutsider_revertsAndSlashesNobody`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P36
- `testFuzz_applyFraudProofs_blockZeroPastGenesisNeverSlashes`: UNIT-TEST-FRAUD-PROOF-FACET-1-BWVNPG.P37
