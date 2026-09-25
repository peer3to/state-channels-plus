# AStateMachine.sol

> **Source:** [contracts/V1/AStateMachine.sol](../../../../../../contracts/V1/AStateMachine.sol)
>
> **Design views:** [architecture/contracts/state-machine-base.md](../../../views/architecture/contracts/state-machine-base.md)

## Requirements

- [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
  Partial: No static or runtime policy rejects an application that reads prohibited ambient context or `_tx.body`.
- [`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr)
  Partial: Interface implemented; integrator conformance pending — Canonical field/collection ordering is application-defined and neither statically checked nor generically tested.
- [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- [`INV-ENFSM-1-762ACD` (Replay from supplied state only)](../../../../specification/enforcement/execution-and-consumer.md#inv-enfsm-1-762acd)
- [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- [`REQ-SM-10-JD8TSF` (Slashing or removal of a participant absent from the state being transformed…)](../../../../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
  Partial: Determinism of arbitrary integrator logic is not enforced; the generic cross-runtime replay-equivalence harness is missing.
- [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
  Partial: Interface and concrete Math codec implemented; general conformance pending — No generic round-trip harness exists, and `peekNextToWrite` does not restore live state when its temporary query throws.
- [`REQ-SM-3-88RFP2` (Mappings only with complete deterministic key enumeration)](../../../../specification/protocol-model/state-machines.md#req-sm-3-88rfp2)
  Partial: Integrator obligation; not generically enforced — No linter, runtime validator, or shared test harness detects incomplete or nondeterministic mapping enumeration.
- [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v)
  Partial: Interface and simple-amount implementation present; custom algebra pending — Arbitrary `Balance.data` algebras remain integrator-owned and have no reusable conformance harness.
- [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b)
  Partial: Interface implemented; integrator conformance pending — Solidity mutability constrains state writes but does not prove canonical custom-data semantics or cross-runtime determinism.
- [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
  Partial: Dispatch and concrete admission/top-up implemented; general conformance pending — The Math path demonstrates the required behavior, but no generic conformance suite proves it for another application contract.
- [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
  Partial: Interface split across contract and local adapter; engineer audit pending — Interface presence is visible in source, but completeness, atomic failure, and semantic equivalence have not been audited operation by operation.
- [`REQ-FIN-5-DH29VZ` (Block authoring is deterministic)](../../../../specification/protocol-model/finality.md#req-fin-5-dh29vz)
- [`REQ-LIF-3-PDRTPY` (A normal state transition MAY produce an outbound message)](../../../../specification/settlement/lifecycle.md#req-lif-3-pdrtpy)

## UNIT-TEST-ASTATE-MACHINE-1-67J5W6

Context injection and round trips

- Setup: Execute transitions reading injected vs ambient context; serialize/restore cycles
- Oracle: Injected values govern; ambient reads detectable; byte-exact round trips

- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P1` — injected author field
- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P2` — ambient divergence detection
- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P3` — round-trip + re-execution equality
- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P4` — joinChannel membership entry
- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P5` — injected time field
- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P6` — injected position field
- [ ] `UNIT-TEST-ASTATE-MACHINE-1-67J5W6.P7` — removeParticipant membership entry

## UNIT-TEST-SM-ASTATE-1-S1YSJG

Transition orchestration

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-ASTATE-1-S1YSJG.P1` — Clear prior messages, inject the header, enforce the gas budget, dispatch calldata, and return success with zero outbound messages
- [ ] `UNIT-TEST-SM-ASTATE-1-S1YSJG.P2` — a successful transition returns one outbound message
- [ ] `UNIT-TEST-SM-ASTATE-1-S1YSJG.P3` — a successful transition returns many outbound messages in order

## UNIT-TEST-SM-ASTATE-2-X06ZXW

Transition rejection

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-ASTATE-2-X06ZXW.P1` — A revert with data rejects deterministically and exposes neither partial state nor partial outbound messages
- [ ] `UNIT-TEST-SM-ASTATE-2-X06ZXW.P2` — a revert without data rejects with the same guarantees

## UNIT-TEST-SM-ASTATE-3-W1VEFR

Injected execution context

- Specification: [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
- Specification tests: [`REQ-SM-1-Y72CKX.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx.t1)

- [ ] `UNIT-TEST-SM-ASTATE-3-W1VEFR.P1` — Only the injected participant/time and dispatched arguments affect application behavior
- [ ] `UNIT-TEST-SM-ASTATE-3-W1VEFR.P2` — ambient EVM values do not
- [ ] `UNIT-TEST-SM-ASTATE-3-W1VEFR.P3` — `_tx.body` does not

## UNIT-TEST-SM-ASTATE-4-25RMFZ

State boundary

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-ASTATE-4-25RMFZ.P1` — Concrete subclasses round-trip valid states through `setState`/`getState`
- [ ] `UNIT-TEST-SM-ASTATE-4-25RMFZ.P2` — malformed encodings reject without partial mutation through `setState`

## UNIT-TEST-SM-ASTATE-5-HYC257

Inbound dispatch

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1)

- [x] `UNIT-TEST-SM-ASTATE-5-HYC257.P1` — Join messages decode and reach `_joinChannel`
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P2` — custom messages reach only the custom hook
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P3` — hook-false paths are atomic
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P4` — unknown-type messages reach only the custom hook
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P5` — hook-revert paths are atomic

## UNIT-TEST-SM-ASTATE-6-KJSK5V

Removal and slashing wrappers

- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P1` — Equivalent successful removal and slashing produce one canonical exit message
- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P2` — successful removal records its returned exit exactly once
- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P3` — wrapper failure does not leak state or messages
- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P4` — retry after failure does not leak state or messages

## UNIT-TEST-SM-ASTATE-7-BMXBKT

Complete public interface

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P1` — The transition entry point is callable with canonical inputs, correct mutability, deterministic rejection, and no undeclared side effects
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P2` — the state hooks satisfy the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P3` — the balance hooks satisfy the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P4` — the next-writer selector satisfies the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P5` — inbound dispatch satisfies the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P6` — the removal/slashing wrappers satisfy the same oracle
