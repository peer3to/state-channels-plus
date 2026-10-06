# test/utils/preferLocal.test.ts — Test Report

> **Test file:** [preferLocal.test.ts](../../../../../../test/utils/preferLocal.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [localDiamond.ts.md](../../../../implementation/source/src/utils/localDiamond.ts.md)

## Overview

Calls `preferLocal(local, onChain, acceptLocal)` directly. Most cases use async stand-ins for the
local and chain reads and a boolean acceptance rule; the chain read counts its calls. The oracles
are the returned answer, the chain-read count, and, for a failing read, the exact rejection. The
synthetic revert uses the message the local signer surfaces for an executor revert
(`Local contract call failed: Error: Local EVM execution failed: …`, built from `LOCAL_EVM_EXECUTION_FAILED`),
and the failure cases also assert what `isLocalEvmExecutionFailure` answers for that error.

Two cases use a real `ContractExecutor` with a `LocalContractExecutorSigner`: a `MathStateMachine`
deployed with a transition budget above the executor's default call gas makes its
`stateTransition` revert inside the executor's EVM, and a signer call with no target fails before
the EVM. They show that a real revert carries the marker through the signer and that a real
non-revert failure does not. Which caller accepts which answer is out of scope (owned by the
calling components' suites).

## Tests and covered test IDs

| Test declaration                                                                                                                                                                | Covers                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: preferLocal > keeps an acceptable local answer without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L26) (line 26)                               | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P1`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p1)                                                                                                                                                           |
| [`Unit: preferLocal > asks the chain when the local answer would make the node act`](../../../../../../test/utils/preferLocal.test.ts#L41) (line 41)                            | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P2`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p2)                                                                                                                                                           |
| [`Unit: preferLocal > propagates a local EVM revert without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L56) (line 56)                                  | —                                                                                                                                                                                                                                                                                                   |
| [`Unit: preferLocal > propagates a local failure that is not a revert without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L78) (line 78)                | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P4`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p4), [`UNIT-TEST-EVM-ERROR-HANDLER-1-DP1MJF.P32`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-1-dp1mjf.p32) |
| [`Unit: preferLocal > propagates the chain's rejection of a confirmation read`](../../../../../../test/utils/preferLocal.test.ts#L100) (line 100)                               | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P5`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p5)                                                                                                                                                           |
| [`Unit: preferLocal > propagates a real local contract call revert in the executor without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L116) (line 116) | —                                                                                                                                                                                                                                                                                                   |
| [`Unit: preferLocal > propagates a real local signer failure that is not a revert without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L164) (line 164)  | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P8`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p8)                                                                                                                                                           |
| [`Unit: preferLocal > propagates an acceptance-callback failure without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L195) (line 195)                    | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P10`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p10)                                                                                                                                                         |
