# DepartedTimeoutCalldataPosted.t.sol

Test file: [test/V1/StateChannelDiamondProxy/DepartedTimeoutCalldataPosted.t.sol](../../../../../../../test/V1/StateChannelDiamondProxy/DepartedTimeoutCalldataPosted.t.sol)

## Overview

Exercises calldata evidence against a timeout issued by a departed peer and checks the contract result.

## Tests

- `test_U126_qualifyingPostedBlockKillsTheDepartedSubmittersTimeout`: REQ-FP-7-4DD0D7.T4.P4, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P171
- `test_U126_postedBlockAfterTheTimeoutWindowDoesNotKill`: REQ-FP-7-4DD0D7.T4.P5, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P172
- `test_U126_postedBlockOfAnotherAuthorDoesNotKill`: REQ-FP-7-4DD0D7.T4.P6, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P173
- `test_U126_postedBlockAtAnotherHeightDoesNotKill`: REQ-FP-7-4DD0D7.T4.P7, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P174
- `test_U126_postedBlockWithFailingTransitionDoesNotKill`: REQ-FP-7-4DD0D7.T4.P8, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P175
