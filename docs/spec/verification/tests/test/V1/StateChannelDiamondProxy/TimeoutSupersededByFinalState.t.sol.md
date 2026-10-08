# TimeoutSupersededByFinalState.t.sol

Test file: [test/V1/StateChannelDiamondProxy/TimeoutSupersededByFinalState.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/TimeoutSupersededByFinalState.t.sol)

## Overview

Applies timeout-supersession counters using later finality or a trusted chain anchor. Checks equal and greater heights, wrong forks, missing finality and absent timeout controls.

## Tests

- `test_timeoutSuperseded_finalStateAboveTheTimeoutHeightKillsTheTimeout`: REQ-FP-7-4DD0D7.T2.P13, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P49
- `test_timeoutSuperseded_finalStateAtTheTimeoutHeightKillsTheTimeout`: REQ-FP-7-4DD0D7.T2.P14, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P50
- `test_timeoutSuperseded_sameForkChainAnchorAboveTheTimeoutHeightKillsWithAnEmptyProof`: REQ-FP-7-4DD0D7.T2.P15, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P51
- `test_timeoutSuperseded_finalStateBelowTheTimeoutHeightDoesNotKill`: REQ-FP-7-4DD0D7.T2.P16, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P52
- `test_timeoutSuperseded_proofNamingAnotherForkDoesNotKill`: REQ-FP-7-4DD0D7.T4.P3, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P170
- `test_timeoutSuperseded_hopMissingARequiredSignatureDoesNotKill`: REQ-FP-7-4DD0D7.T2.P17, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P53
- `test_timeoutSuperseded_disputeWithoutATimeoutIsNotKilled`: REQ-FP-7-4DD0D7.T2.P18, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P54
- `test_timeoutSuperseded_forkGenesisIsNoFinalStateAtTheTimeoutHeight`: REQ-FP-7-4DD0D7.T2.P19, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P55
- `test_timeoutSuperseded_anchorOnAnotherForkAboveTheTimeoutHeightDoesNotKill`: REQ-FP-7-4DD0D7.T2.P20, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P56
- `test_timeoutSuperseded_sameForkAnchorAtTheTimeoutHeightKills`: REQ-FP-7-4DD0D7.T2.P21, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P57
- `test_timeoutSuperseded_realFinalStateOnAnotherForkDoesNotKill`: REQ-FP-7-4DD0D7.T2.P22, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P58
