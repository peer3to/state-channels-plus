# CalldataPostingService.test.ts

Test file: [test/unit/CalldataPostingService.test.ts](../../../../../../test/unit/CalldataPostingService.test.ts)
Exercises: [CalldataPostingService](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md)

## Overview

Real sessions exercise no-op decisions, successful publication, and a real reverted receipt after a test control changes the submitted deadline. The receipt case drains the complete operations and asserts no detached failure and no stored calldata timestamp.

## Tests

- `every participant signed the block → nothing posted on-chain`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P1
- `hash of a block this peer does not store → no-op`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P2
- `an expired calldata receipt is handled before detached collection`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P4
- `a block nobody else signed → author posts its calldata on-chain`: UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P3
