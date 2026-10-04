# test/evm/InvalidStateTransitionError.test.ts — Test Report

> **Test file:** [test/evm/InvalidStateTransitionError.test.ts](../../../../../../test/evm/InvalidStateTransitionError.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [evmErrorHandler.ts](../../../../implementation/source/src/utils/evmErrorHandler.ts.md), [EvmDiamondStateMachine.ts](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite checks the rule that only a failure inside the EVM, within the transition's full budget,
is an invalid state transition. Every test deploys a Math machine (`deployMathMachine` in
`test/fixtures/LocalEvmCallGas.fixture.ts`) into a real executor: an inline `ContractExecutor` on a
fresh EVM, or an SDK-owned executor (`createSdkOwnedExecutor`) whose next `executeCall` request is
corrupted (`corruptNextSdkExecutorRequest`) so the executor connection fails.

Four tests classify the thrown error with `isInvalidStateTransitionError`. An `add(1)` sent by an
address that is not the next writer reverts inside the EVM: the error is invalid. A machine whose
17M budget needs more than the executor's default call gas refuses to run: the message names `ErrorInsufficientGasForStateTransition` and the error is not
invalid. An `add(1)` with 4 MiB of extra input exhausts the call's own frame while copying the input,
before the stipend check: the message ends in `: out of gas` and the error is not invalid. The
corrupted executor request fails with an error that is not invalid; the machine's sum stays 0.

Three tests call `EvmDiamondStateMachine.stateTransition` (`createDiamondStateMachine`, with the
runtime's unlimited-contract-size EVM option for the inline cases). The reverting transition returns
`success: false` with no outbound messages. The under-funded transition throws an error naming
`ErrorInsufficientGasForStateTransition` instead of returning an invalid result, and the sum stays 0.
The corrupted executor request throws an error, and the sum stays 0.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                    | Covers                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`isInvalidStateTransitionError > a transition that reverts inside the EVM is an invalid state transition`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L27) (line 27)                           | [`UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P1`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-2-9fdw1w.p1)                                                                                                                           |
| [`isInvalidStateTransitionError > a refusal to run under-funded is not an invalid state transition`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L46) (line 46)                                  | [`UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P2`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-2-9fdw1w.p2)                                                                                                                           |
| [`isInvalidStateTransitionError > an out-of-gas of the call's own frame is not an invalid state transition`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L59) (line 59)                          | [`UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P3`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-2-9fdw1w.p3), [`REQ-ENFSM-1-DKJCY2.T1.P14`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p14) |
| [`isInvalidStateTransitionError > a failed executor connection is not an invalid state transition`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L77) (line 77)                                   | [`UNIT-TEST-EVM-ERROR-HANDLER-2-9FDW1W.P4`](../../../../implementation/source/src/utils/evmErrorHandler.ts.md#unit-test-evm-error-handler-2-9fdw1w.p4)                                                                                                                           |
| [`isInvalidStateTransitionError > stateTransition returns an invalid transition for a transition that reverts`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L97) (line 97)                       | [`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P1`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-2-d2b2bg.p1), [`REQ-ENFSM-1-DKJCY2.T1.P16`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p16)  |
| [`isInvalidStateTransitionError > stateTransition throws a refusal to run under-funded instead of returning an invalid transition`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L119) (line 119) | [`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P2`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-2-d2b2bg.p2)                                                                                                                            |
| [`isInvalidStateTransitionError > stateTransition throws a failed executor connection instead of returning an invalid transition`](../../../../../../test/evm/InvalidStateTransitionError.test.ts#L142) (line 142)  | [`UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P3`](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md#unit-test-evm-diamond-sm-2-d2b2bg.p3), [`REQ-ENFSM-1-DKJCY2.T1.P15`](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2.t1.p15)  |
