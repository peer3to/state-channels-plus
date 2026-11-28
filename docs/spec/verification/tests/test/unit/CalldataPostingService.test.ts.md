# CalldataPostingService.test.ts

Test file: [test/unit/CalldataPostingService.test.ts](../../../../../../test/unit/CalldataPostingService.test.ts)
Exercises: [CalldataPostingService](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md)

## Overview

Real sessions exercise no-op decisions, successful publication, and a real reverted receipt after a test control changes the submitted deadline. The receipt case drains the complete operations and asserts no detached failure and no stored calldata timestamp. Two cases turn history pruning on for every peer: the author's fully signed final-point block, after a chain anchor advance, and the writer's final-point block one signature short (the next writer's signature withheld, the third peer not signing the block above). Premises check the author's own final point, its signature state and that the block below is deleted; the decision then returns, the drained operations report no failure, no calldata event fires and no calldata timestamp is stored.

## Tests

- `every participant signed the block → nothing posted on-chain`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P1
- `hash of a block this peer does not store → no-op`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P2
- `an expired calldata receipt is handled before detached collection`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P4
- `a block nobody else signed → author posts its calldata on-chain`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P3
- `pruning on, a fully signed final-point block whose block below is pruned → resolves and nothing is posted on-chain`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P5, REQ-PROOFSTORE-8-R38KY5.T1.P12
- `pruning on, a final-point block one signature short whose block below is pruned → resolves and nothing is posted on-chain`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P6, REQ-PROOFSTORE-8-R38KY5.T1.P13
