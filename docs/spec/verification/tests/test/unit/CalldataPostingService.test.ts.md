# test/unit/CalldataPostingService.test.ts — Test Report

> **Test file:** [test/unit/CalldataPostingService.test.ts](../../../../../../test/unit/CalldataPostingService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [CalldataPostingService](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md)

## Overview

Real sessions exercise no-op decisions, successful publication, and a real reverted receipt after a test control changes the submitted deadline. The receipt case drains the complete operations and asserts no detached failure and no stored calldata timestamp.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                       | Covers                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`Unit: CalldataPostingService > maybePostBlockOnChain > every participant signed the block → nothing posted on-chain`](../../../../../../test/unit/CalldataPostingService.test.ts#L10) (line 10)      | [`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P1`](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md#unit-test-calldata-posting-service-1-p42419.p1) |
| [`Unit: CalldataPostingService > maybePostBlockOnChain > hash of a block this peer does not store → no-op`](../../../../../../test/unit/CalldataPostingService.test.ts#L48) (line 48)                  | [`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P2`](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md#unit-test-calldata-posting-service-1-p42419.p2) |
| [`Unit: CalldataPostingService > maybePostBlockOnChain > an expired calldata receipt is handled before detached collection`](../../../../../../test/unit/CalldataPostingService.test.ts#L68) (line 68) | [`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P4`](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md#unit-test-calldata-posting-service-1-p42419.p4) |
| [`Unit: CalldataPostingService > maybePostBlockOnChain > a block nobody else signed → author posts its calldata on-chain`](../../../../../../test/unit/CalldataPostingService.test.ts#L107) (line 107) | [`UNIT-TEST-CALLDATA-POSTING-SERVICE-1-P42419.P3`](../../../../implementation/source/src/stateManager/chainFallback/CalldataPostingService.ts.md#unit-test-calldata-posting-service-1-p42419.p3) |
