# ContractExecutorCallGas.test.ts

Test file: [test/evm/ContractExecutorCallGas.test.ts](../../../../../../test/evm/ContractExecutorCallGas.test.ts)
Exercises: [ContractExecutor.ts](../../../../implementation/source/src/evm/contractExecutor/ContractExecutor.ts.md)

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

## Tests

- `defaults to the EVM's call gas`: UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P1
- `raises the call gas to the dispute-execution budget`: UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P2
- `raises the call gas to twice the replay gas`: UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P3
- `refuses a transition above the default call gas when not raised`: UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P4, REQ-MIRROR-4-H9C4YS.T1.P11
- `runs a transition above the default call gas when raised to its requirement`: UNIT-TEST-CONTRACT-EXECUTOR-2-XTM118.P5, REQ-MIRROR-4-H9C4YS.T1.P10
- `an inline executor runs a transition whose replay requirement exceeds the default call gas`: UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P1
- `a dedicated executor thread runs a transition whose replay requirement exceeds the default call gas`: UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P2
- `a rejected startup replay requirement read rejects readiness with no inline executor and closes the runtime`: UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P3
- `a rejected startup replay requirement read rejects readiness with no dedicated executor thread and closes the runtime`: UNIT-TEST-P2P-RUNTIME-HOST-33-W7YA4J.P4
