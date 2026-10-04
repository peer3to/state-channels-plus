# test/utils/preferLocal.test.ts — Test Report

> **Test file:** [preferLocal.test.ts](../../../../../../test/utils/preferLocal.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [localDiamond.ts.md](../../../../implementation/source/src/utils/localDiamond.ts.md)

## Overview

Calls `preferLocal(local, onChain, acceptLocal)` directly. Most cases use async stand-ins for the
local and chain reads and a boolean acceptance rule; the chain read counts its calls. The oracles
are the returned answer, the chain-read count, and, for a failing read, the exact rejection. The
synthetic revert uses the message the local signer surfaces for an executor revert
(`Local contract call failed: Error: Local EVM execution failed: …`, built from
`LOCAL_EVM_EXECUTION_FAILED`); the case asserts that this revert propagates as the same error with
no chain read.

One case uses a real `ContractExecutor` with a `LocalContractExecutorSigner`: a signer call with no
target fails before the EVM, and that failure propagates with no chain read. Which caller accepts
which answer is out of scope (owned by the calling components' suites).

## Tests and covered test IDs

| Test declaration                                                                                                                                             | Covers                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: preferLocal > keeps an acceptable local answer without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L17) (line 17)            | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P1`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p1)   |
| [`Unit: preferLocal > asks the chain when the local answer would make the node act`](../../../../../../test/utils/preferLocal.test.ts#L32) (line 32)         | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P2`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p2)   |
| [`Unit: preferLocal > propagates a local revert without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L47) (line 47)                   | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P4`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p4)   |
| [`Unit: preferLocal > propagates the chain's rejection of a confirmation read`](../../../../../../test/utils/preferLocal.test.ts#L68) (line 68)              | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P5`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p5)   |
| [`Unit: preferLocal > propagates a real local signer failure without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L84) (line 84)      | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P8`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p8)   |
| [`Unit: preferLocal > propagates an acceptance-callback failure without asking the chain`](../../../../../../test/utils/preferLocal.test.ts#L114) (line 114) | [`UNIT-TEST-PREFER-LOCAL-1-XC95T6.P10`](../../../../implementation/source/src/utils/localDiamond.ts.md#unit-test-prefer-local-1-xc95t6.p10) |
