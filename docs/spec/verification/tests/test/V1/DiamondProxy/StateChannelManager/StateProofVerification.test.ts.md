# StateProofVerification.test.ts

Test file: [test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts](../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts)
Exercises: [StateProofFacet.sol](../../../../../../implementation/source/contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol.md)

## Overview

Calls the public proof views through the deployed manager proxy. Cases distinguish undecodable
retained bytes from decodable genesis-linked controls, check the auditing-data commitment, and
check standalone finality under an explicitly supplied one-signer threshold. A step fault returns
true from the invalidity predicate; normal verification predicates reject malformed bytes without
reverting. The controls exercise their opposite results.

## Tests

- `isStateProofStepInvalid rejects a challenge whose posted auditing data does not match disputeAuditingDataHash`: REQ-SP-7-70EMAT.T5.P1, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P22
- `isStateProofStepInvalid judges a milestone block with undecodable bytes invalid instead of reverting`: REQ-SP-7-70EMAT.T5.P2, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P23
- `isCorrectLatestState returns false instead of reverting when latest block is undecodable`: REQ-SP-7-70EMAT.T5.P3, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P24
- `verifyMilestones returns false instead of reverting when a milestone block is undecodable`: REQ-SP-7-70EMAT.T5.P4, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P25
- `isMilestoneFinal returns false instead of reverting when a milestone block is undecodable`: REQ-SP-7-70EMAT.T5.P5, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P26
- `control: isStateProofStepInvalid finds no fault in the same step when its block decodes`: REQ-SP-7-70EMAT.T5.P6, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P27
- `control: isCorrectLatestState returns true when the latest block decodes and commits the latest state`: REQ-SP-7-70EMAT.T5.P7, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P28
- `control: verifyMilestones accepts the proof when its block decodes`: REQ-SP-7-70EMAT.T5.P8, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P29
- `control: isMilestoneFinal finalizes the milestone when its block decodes and its signer is the whole threshold set`: REQ-SP-7-70EMAT.T5.P9, UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P30
