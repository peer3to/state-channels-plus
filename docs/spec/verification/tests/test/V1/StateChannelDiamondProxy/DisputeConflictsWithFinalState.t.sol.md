# DisputeConflictsWithFinalState.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DisputeConflictsWithFinalState.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DisputeConflictsWithFinalState.t.sol)

## Overview

Applies final-state conflict counters to disputes and controls. Checks exact final-height conflict, same-fork proof validity, protected historical blocks and resulting slashes.

## Tests

- `test_conflictWithFinalState_blockAtTheFinalHeightCommittingAnotherSnapshotKillsTheDispute`: REQ-FP-7-4DD0D7.T2.P2, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P38
- `test_conflictWithFinalState_sameSnapshotAtTheFinalHeightDoesNotKill`: REQ-FP-7-4DD0D7.T2.P3, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P39
- `test_conflictWithFinalState_blockAboveTheFinalHeightDoesNotKill`: REQ-FP-7-4DD0D7.T2.P4, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P40
- `test_conflictWithFinalState_finalProofOnAnotherForkDoesNotKill`: REQ-FP-7-4DD0D7.T4.P1, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P168
- `test_conflictWithFinalState_invalidFinalProofDoesNotKill`: REQ-FP-7-4DD0D7.T2.P5, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P41
- `test_conflictWithFinalState_forkGenesisAsTheFinalPointDoesNotKill`: REQ-FP-7-4DD0D7.T2.P6, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P42
- `test_conflictWithFinalState_blockOfHistoryBelowTheAnchorDoesNotKill`: REQ-FP-7-4DD0D7.T2.P7, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P43
- `test_conflictWithFinalState_realFinalStateOnAnotherForkDoesNotKill`: REQ-FP-7-4DD0D7.T2.P8, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P44
- `test_conflictWithFinalState_conflictingBlockNamingAnotherForkDoesNotKill`: REQ-FP-7-4DD0D7.T4.P2, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P169
- `test_conflictWithFinalState_blockBeforeTheAnchorBlockInTheRunIsNoConflict`: REQ-FP-7-4DD0D7.T2.P9, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P45
- `test_conflictWithFinalState_anchorRunAsTheFinalProofProvesTheAnchor`: REQ-FP-7-4DD0D7.T2.P10, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P46
- `test_conflictWithFinalState_conflictingFirstBlockOfASecondHopMilestoneKills`: REQ-FP-7-4DD0D7.T2.P11, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P47
- `test_conflictWithFinalState_staleFinalProofBelowAnAdvancedAnchorProvesTheAnchor`: REQ-FP-7-4DD0D7.T2.P12, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P48
