# InvalidStateTransitionError.test.ts

Test file: [test/evm/InvalidStateTransitionError.test.ts](../../../../../../test/evm/InvalidStateTransitionError.test.ts)
Exercises: [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md), [EvmDiamondStateMachine.ts](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md)

## Overview

The suite checks the rule that only a failure inside the EVM, within the transition's full budget,
is an invalid state transition. Every test deploys a Math machine (`deployMathMachine` in
`test/fixtures/LocalEvmCallGas.fixture.ts`) into a real executor: an inline `ContractExecutor` on a
fresh EVM, or an SDK-owned executor (`createSdkOwnedExecutor`) whose next `executeCall` request is
corrupted (`corruptNextSdkExecutorRequest`) so the executor connection fails.

Four tests classify the thrown error with `isInvalidStateTransitionError`. An `add(1)` sent by an
address that is not the next writer reverts inside the EVM: the error carries the local revert
marker and is invalid. A machine whose 17M budget needs more than the executor's default call gas
refuses to run: the message names `ErrorInsufficientGasForStateTransition` and the error is not
invalid. An `add(1)` with 4 MiB of extra input exhausts the call's own frame while copying the input,
before the stipend check: the message ends in `: out of gas` and the error is not invalid. The
corrupted executor request fails without the revert marker and is not invalid; the machine's sum
stays 0.

Three tests call `EvmDiamondStateMachine.stateTransition` (`createDiamondStateMachine`, with the
runtime's unlimited-contract-size EVM option for the inline cases). The reverting transition returns
`success: false` with no outbound messages. The under-funded transition throws an error naming
`ErrorInsufficientGasForStateTransition` instead of returning an invalid result, and the sum stays 0.
The corrupted executor request throws an error without the revert marker, and the sum stays 0.

## Tests

- `a transition that reverts inside the EVM is an invalid state transition`: UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P1
- `a refusal to run under-funded is not an invalid state transition`: UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P2
- `an out-of-gas of the call's own frame is not an invalid state transition`: UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P3, REQ-ENFSM-1-DKJCY2.T1.P14
- `a failed executor connection is not an invalid state transition`: UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P4
- `stateTransition returns an invalid transition for a transition that reverts`: UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P1, REQ-ENFSM-1-DKJCY2.T1.P16
- `stateTransition throws a refusal to run under-funded instead of returning an invalid transition`: UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P2
- `stateTransition throws a failed executor connection instead of returning an invalid transition`: UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P3, REQ-ENFSM-1-DKJCY2.T1.P15
