# ADiamondStateMachine.ts

> **Source:** [src/ADiamondStateMachine.ts](../../../../../src/ADiamondStateMachine.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-SM-4-Z32M0W` (Ordering/encoding/round-trip defined explicitly)](../../../specification/protocol-model/state-machines.md#req-sm-4-z32m0w)
  Partial: No channel-level encoding/version guard proves that an existing channel cannot be pointed at incompatible logic or encoding.
- [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
  Partial: Interface split across contract and local adapter; engineer audit pending — Interface presence is visible in source, but completeness, atomic failure, and semantic equivalence have not been audited operation by operation.

## UNIT-TEST-SM-INTERFACE-1-P7RP93

Capability completeness

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-INTERFACE-1-P7RP93.P1` — A concrete conformance subclass must implement transition, view, participant, selector, state, balance, inbound, address, and disposal capabilities

## UNIT-TEST-SM-INTERFACE-2-PGAF55

Boundary typing and failure

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-INTERFACE-2-PGAF55.P1` — Valid values are representable without undocumented return shapes
- [ ] `UNIT-TEST-SM-INTERFACE-2-PGAF55.P2` — boundary values are representable without undocumented return shapes
- [ ] `UNIT-TEST-SM-INTERFACE-2-PGAF55.P3` — malformed values and rejection semantics are representable without partial mutation

## UNIT-TEST-SM-INTERFACE-3-VD5ZBB

Adapter substitutability

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d), [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1), [`INV-SM-2-0FTJ2T.T1`](../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-INTERFACE-3-VD5ZBB.P1` — Every concrete adapter can be used through this abstraction without changing deterministic transition or state semantics
