# test/evm/ContractExecutorCallGas.test.ts — Test Report

> **Test file:** [test/evm/ContractExecutorCallGas.test.ts](../../../../../../test/evm/ContractExecutorCallGas.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [ContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Three tests call the pure `localEvmCallGasLimit(disputeExecutionGasLimit, stateTransitionReplayGas)`
and check the exact result: a 3M budget and a 3M replay gas (twice that still under the floor) give
`DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT` (0xffffff), a 20M budget with a 3.5M replay gas gives 20M, and a
17.54M replay gas with a 16M budget gives twice the replay gas, 35.08M.

Two tests run a real inline `ContractExecutor` on a fresh EVM. The fixture
(`test/fixtures/LocalEvmCallGas.fixture.ts`, `deployMathMachine`) deploys a Math machine
with a 17M transition budget, restores a one-participant state, and calls `stateTransition` with
that participant's `add(1)`. The first test builds the executor without `callGasLimit`, checks that
the machine's `getStateTransitionGasRequirement()` exceeds the floor, and asserts that the call
fails with the decoded custom error `ErrorInsufficientGasForStateTransition` and `getSum` stays 0.
The second reads the requirement from a probe executor, builds a new executor with
`callGasLimit = localEvmCallGasLimit(17M, requirement)`, and asserts that the same call runs and
`getSum` becomes 1.

Two tests start a real three-peer runtime whose manager is deployed with a transition budget
above the default call gas (`startWithTransitionBudget`): one with the inline executor, one with
the executor on its dedicated thread (`VM_DEDICATED_THREAD`). Each checks that the manager's
`getStateTransitionReplayGas()` exceeds `DEFAULT_LOCAL_EVM_CALL_GAS_LIMIT`, advances the channel
by two transitions, and asserts that every peer's local `getSum` moved by two. The transitions run
only if the host read the manager's inputs at startup and the raised limit reached the executor
(for the thread, across the decimal-string round trip).

Two tests fail the startup replay-requirement read (`assertStartupReplayGasReadFailure`), one with
the inline executor and one with the dedicated executor thread. The manager is deployed with a
`SimpleNumberStorage` state machine, which has no `getStateTransitionGasRequirement`, so the reads
before it still answer (`getAllTimes` returns four values, `getGasLimit` is positive) and the manager's
`getStateTransitionReplayGas` read reverts. Each asserts that runtime
setup rejects with a `CALL_EXCEPTION` naming the replay-gas selector, that no executor was
requested from the recording `createContractExecutor`, that at least one runtime root was started,
and that every started root was closed.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                  | Covers                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ContractExecutor call gas > defaults to the EVM's call gas`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L18) (line 18)                                                                                          | [`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P1`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-2-xtm118.p1)                                                                                                                   |
| [`ContractExecutor call gas > raises the call gas to the dispute-execution budget`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L24) (line 24)                                                                     | [`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P2`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-2-xtm118.p2)                                                                                                                   |
| [`ContractExecutor call gas > raises the call gas to twice the replay gas`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L30) (line 30)                                                                             | [`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P3`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-2-xtm118.p3)                                                                                                                   |
| [`ContractExecutor call gas > refuses a transition above the default call gas when not raised`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L36) (line 36)                                                         | [`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P4`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-2-xtm118.p4), [`REQ-MIRROR-4-H9C4YS.T1.P11`](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys.t1.p11) |
| [`ContractExecutor call gas > runs a transition above the default call gas when raised to its requirement`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L59) (line 59)                                             | [`UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P5`](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md#unit-test-contract-executor-2-xtm118.p5), [`REQ-MIRROR-4-H9C4YS.T1.P10`](../../../../specification/enforcement/local-mirror.md#req-mirror-4-h9c4ys.t1.p10) |
| [`ContractExecutor call gas > an inline executor runs a transition whose replay requirement exceeds the default call gas`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L90) (line 90)                              | [`UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P1`](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-33-w7ya4j.p1)                                                                                                                   |
| [`ContractExecutor call gas > a dedicated executor thread runs a transition whose replay requirement exceeds the default call gas`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L105) (line 105)                   | [`UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P2`](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-33-w7ya4j.p2)                                                                                                                   |
| [`ContractExecutor call gas > a rejected startup replay requirement read rejects readiness with no inline executor and closes the runtime`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L120) (line 120)           | [`UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P3`](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-33-w7ya4j.p3)                                                                                                                   |
| [`ContractExecutor call gas > a rejected startup replay requirement read rejects readiness with no dedicated executor thread and closes the runtime`](../../../../../../test/evm/ContractExecutorCallGas.test.ts#L124) (line 124) | [`UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P4`](../../../../implementation/source/src/rpc/internal/roots/P2pRuntimeHostRoot.ts.md#unit-test-p2p-runtime-host-33-w7ya4j.p4)                                                                                                                   |
