# test/utils/ContractErrors.test.ts — Test Report

> **Test file:** [test/utils/ContractErrors.test.ts](../../../../../../../test/utils/ContractErrors.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the custom-EVM-error path at three levels. First, it sanity-checks
`GeneratedArtifacts`: `artifacts` load with abi/contractName/bytecode and `errorAbis` contains
only `type: "error"` entries (the ABI set `evmErrorHandler`'s parser is built from). Second, it
drives `tryDecodeCustomError`/`tryHandleEvmError` with synthetic errors carrying hand-computed
4-byte selectors: five named race-condition/error selectors decode to the right
`errorDescription.name`, a plain `Error` with no revert data returns `null` and passes through
unchanged, and a registered handler receives the `CustomEvmError` wrapping the original error.
Third, real hardhat calls through `deployMathChannelProxyFixture` hit `postBlockCalldata` and
decode genuine on-chain reverts (`ErrorBlockCalldataMsgSenderNotBlockAuthor`,
`RaceConditionBlockCalldataTimestampTooLate`, `ErrorBlockCalldataAlreadyPosted`) plus one success
case. `UNIT-TEST-EVM-ERROR-HANDLER-1` now defines one permutation per named error; the five
names this suite decodes are assigned. The distinctive `.P2`/`.P3` scenarios — revert data with
an unknown selector and malformed revert data — still have no dedicated test (the plain-`Error`
case exercises the missing-data guard, a different path), and the remaining named-error
permutations are undecoded here. `ErrorDisputeAlreadyPosted`, `ErrorBlockCalldataAlreadyPosted`,
and `ErrorBlockCalldataMsgSenderNotBlockAuthor` have no permutation in the pool.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`artifacts loading > should load all required facet artifacts`](../../../../../../../test/utils/ContractErrors.test.ts#L16) (line 16)                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`artifacts loading > should extract error ABIs from artifacts`](../../../../../../../test/utils/ContractErrors.test.ts#L29) (line 29)                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`ContractCaller and ContractErrors > should decode  contract errors correctly`](../../../../../../../test/utils/ContractErrors.test.ts#L41) (line 41)                                                      | [`UNIT-TEST-EVM-ERROR-HANDLER-1.P7`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1.p7), [`UNIT-TEST-EVM-ERROR-HANDLER-1.P13`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1.p13), [`UNIT-TEST-EVM-ERROR-HANDLER-1.P20`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1.p20) |
| [`ContractCaller and ContractErrors > should pass through regular errors unchanged`](../../../../../../../test/utils/ContractErrors.test.ts#L76) (line 76)                                                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`ContractCaller and ContractErrors > passes the decoded custom error to its handler`](../../../../../../../test/utils/ContractErrors.test.ts#L95) (line 95)                                                | [`UNIT-TEST-EVM-ERROR-HANDLER-1.P11`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1.p11)                                                                                                                                                                                                                                                                                       |
| [`ContractCaller and ContractErrors > Real contract calls > should handle postBlockCalldata success case`](../../../../../../../test/utils/ContractErrors.test.ts#L134) (line 134)                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`ContractCaller and ContractErrors > Real contract calls > should handle ErrorBlockCalldataMsgSenderNotBlockAuthor custom error`](../../../../../../../test/utils/ContractErrors.test.ts#L156) (line 156)  | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`ContractCaller and ContractErrors > Real contract calls > should handle RaceConditionBlockCalldataTimestampTooLate custom error`](../../../../../../../test/utils/ContractErrors.test.ts#L179) (line 179) | [`UNIT-TEST-EVM-ERROR-HANDLER-1.P4`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1.p4)                                                                                                                                                                                                                                                                                         |
| [`ContractCaller and ContractErrors > Real contract calls > should handle ErrorBlockCalldataAlreadyPosted custom error`](../../../../../../../test/utils/ContractErrors.test.ts#L203) (line 203)            | —                                                                                                                                                                                                                                                                                                                                                                                                                                |
