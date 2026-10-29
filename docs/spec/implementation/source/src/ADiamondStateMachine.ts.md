# ADiamondStateMachine.ts

> **Source:** [src/ADiamondStateMachine.ts](../../../../../src/ADiamondStateMachine.ts)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-SM-4-Z32M0W` (Ordering/encoding/round-trip defined explicitly)](../../../specification/protocol-model/state-machines.md#req-sm-4-z32m0w)
- [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)

## UNIT-TEST-SM-INTERFACE-1-P7RP93

Capability completeness

- Setup: Type-check a concrete `ADiamondStateMachine` subclass (`EvmDiamondStateMachine` is the only one) against every abstract member: `stateTransition`, `runView`, `getParticipants`, `getNextToWrite`, `peekNextToWrite`, `setState`/`getState`, the balance methods, `processInboundMessage`, `reduceAndFinalizeLocally`, `getStateMachineAddress` and `dispose`.
- Oracle: The subclass compiles only when it implements all of them, and each implementation is callable through an `ADiamondStateMachine`-typed reference.
- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-INTERFACE-1-P7RP93.P1` — A concrete conformance subclass must implement transition, view, participant, selector, state, balance, inbound, address, and disposal capabilities

## UNIT-TEST-SM-INTERFACE-2-PGAF55

Boundary typing and failure

- Setup: Call each abstract method through an `ADiamondStateMachine` reference with valid values, boundary values (zero balance, empty participant set) and malformed values, plus `requirePositiveBalance` with zero and positive balances.
- Oracle: Results arrive only in the declared shapes (`TransitionResponse`, `Address`, `Bytes`, `BalanceStruct`, `boolean`); a rejection is a rejected promise that leaves `getState` unchanged, and `requirePositiveBalance` throws `<label> must be greater than zero` unless `getZeroBalance` is lesser than the balance.
- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-INTERFACE-2-PGAF55.P1` — Valid values are representable without undocumented return shapes
- [ ] `UNIT-TEST-SM-INTERFACE-2-PGAF55.P2` — boundary values are representable without undocumented return shapes
- [ ] `UNIT-TEST-SM-INTERFACE-2-PGAF55.P3` — malformed values and rejection semantics are representable without partial mutation

## UNIT-TEST-SM-INTERFACE-3-VD5ZBB

Adapter substitutability

- Setup: Drive the same restored state and transaction sequence through an `ADiamondStateMachine`-typed reference and through the concrete adapter directly.
- Oracle: Both paths return the same `stateTransition` success flags and outbound messages and the same `getState` bytes after every step.
- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d), [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1), [`INV-SM-2-0FTJ2T.T1`](../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-INTERFACE-3-VD5ZBB.P1` — Every concrete adapter can be used through this abstraction without changing deterministic transition or state semantics
