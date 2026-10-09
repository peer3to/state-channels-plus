# EvmDiamondStateMachinePeek.test.ts

Test file: [test/evm/EvmDiamondStateMachinePeek.test.ts](../../../../../../test/evm/EvmDiamondStateMachinePeek.test.ts)
Exercises: [EvmDiamondStateMachine.ts](../../../../implementation/source/src/evm/EvmDiamondStateMachine.ts.md)

## Overview

Each test deploys a Math machine (`deployMathMachine` in `test/fixtures/LocalEvmCallGas.fixture.ts`)
into an inline `ContractExecutor` with the runtime's unlimited-contract-size EVM option, and builds the
runtime's `EvmDiamondStateMachine` over it (`createDiamondStateMachine`). The live state holds one
participant whose turn is next; the test reads its bytes with `getState` before the peek.

A state with two participants whose turn index points at the second (`encodeMathState`) is peeked: the
call returns the second participant, and after it `getState` returns the live bytes and
`getNextToWrite` the live writer. An undecodable state (`0x1234`) makes `getNextToWriteOf` revert while
it decodes the state: the call rejects with a message that starts with
`StateMachineInterface.peekNextToWrite:`, and `getState` still returns the live bytes.

## Tests

- `a state whose second participant is next, peeked on a machine whose live state has another next writer -> returns that second participant; getState and getNextToWrite still return the live state's`: UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P1
- `an undecodable state, so getNextToWriteOf reverts -> rejects with StateMachineInterface.peekNextToWrite: …; getState still returns the live state`: UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P4
