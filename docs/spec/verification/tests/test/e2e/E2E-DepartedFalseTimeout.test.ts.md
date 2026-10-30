# E2E-DepartedFalseTimeout.test.ts

Test file: [test/e2e/E2E-DepartedFalseTimeout.test.ts](../../../../../../test/e2e/E2E-DepartedFalseTimeout.test.ts)

## Overview

Challenges a departed peer false timeout using real final-state evidence and checks the resulting kill, slashes and surviving dispute workflow.

The fresh-pending-auditor case keeps authoring while Alice prepares her held exit post.
It waits for that post to park immediately before submitting the auditor's join,
preserving the required ordering without consuming Carol's first authoring window.

## Tests

- `E45: a departed chain-eligible submitter's false timeout of the next author is killed by the accused block's direct threshold signatures; the reduction slashes her and keeps the accused`: REQ-FP-7-4DD0D7.T5.P21, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P196
- `E46: a departed chain-eligible submitter's false timeout of the next author is killed by that author's qualifying posted block calldata; the reduction slashes her and keeps the accused`: REQ-FP-7-4DD0D7.T5.P22, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P197
- `E46 control: a departed chain-eligible submitter's honest timeout of an author who produced nothing is not killed and reaches the reduction`: REQ-FP-7-4DD0D7.T5.P23, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P198
- `departed Alice's false timeout of Bob at the height Carol authored is killed by a fresh pending auditor's own threshold-final state, without the departure state or Bob's calldata; the reduction slashes her and keeps Bob`: REQ-FP-7-4DD0D7.T5.P24, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P199
- `departed Alice's false timeout of Bob at the height Carol authored is not killed by a final state below the timeout height, a final proof naming another fork, or a final proof without its confirmation signatures; the challenger is slashed, and the real final state then kills it`: REQ-FP-7-4DD0D7.T5.P25, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P200
