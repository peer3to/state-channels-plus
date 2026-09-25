# MathStateMachine.sol

> **Source:** [contracts/V1/examples/MathStateMachine/MathStateMachine.sol](../../../../../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol)
>
> **Design views:** [architecture/contracts/state-machine-base.md](../../../../../views/architecture/contracts/state-machine-base.md)

## Requirements

- [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
  Partial: No static or runtime policy rejects an application that reads prohibited ambient context or `_tx.body`.
- [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- [`REQ-SM-10-JD8TSF` (Slashing or removal of a participant absent from the state being transformed…)](../../../../../../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf)
- [`REQ-SM-11-VVP01C` (Application-defined participant insertion)](../../../../../../specification/protocol-model/state-machines.md#req-sm-11-vvp01c)
- [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
  Partial: Interface and concrete Math codec implemented; general conformance pending — No generic round-trip harness exists, and `peekNextToWrite` does not restore live state when its temporary query throws.
- [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v)
  Partial: Interface and simple-amount implementation present; custom algebra pending — Arbitrary `Balance.data` algebras remain integrator-owned and have no reusable conformance harness.
- [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
  Partial: Checked amount arithmetic implemented; custom aggregation pending — No static rule or reusable suite prevents integrator `unchecked` arithmetic or invalid custom-data aggregation.
- [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
  Partial: Dispatch and concrete admission/top-up implemented; general conformance pending — The Math path demonstrates the required behavior, but no generic conformance suite proves it for another application contract.
- [`REQ-FIN-6-YZWJX2` (Recommended leader-election policy is round-robin as a function of channel state)](../../../../../../specification/protocol-model/finality.md#req-fin-6-yzwjx2)

## UNIT-TEST-MATH-INSERTION-1-29TPFK

Public component behavior

- Setup: Real wallet-built blocks or a real session through this component's public boundary.
- Oracle: Exact state, role, attribution, quota, and failure outcomes below; no substituted protocol logic.

- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P1` — the SDK rejects an insertion by the wrong author without changing roster state or eligibility
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P2` — transfers part of the author's balance without changing total value or message anchors
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P3` — accepts zero transfer from a funded author
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P4` — accepts zero transfer from a zero-balance author
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P5` — rejects insufficient balance without changing the state
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P6` — rejects an existing target without changing the state
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P7` — rejects self insertion without changing the state
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P8` — rejects the zero address without changing the state
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P9` — rejects a participant acting out of turn
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P10` — rejects a nonparticipant author
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P11` — selects the next author using the new roster after a wrapped turn index
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P12` — fills the configured N minus one roster to exactly N
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P13` — at capacity advances only the turn counter for a valid positive transfer
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P14` — repeated full-capacity requests each advance exactly one turn
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P15` — a zero-amount request at capacity cannot append a participant
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P16` — an already oversized adopted roster remains unchanged
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P17` — maximum one accepts a valid no-op and keeps its only author
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P18` — capacity does not waive invalid-target checks
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P19` — can transfer the author's exact remaining balance
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P20` — capacity does not waive zero-address rejection
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P21` — capacity does not waive duplicate-participant rejection
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P22` — capacity does not waive insufficient balance
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P23` — capacity does not waive turn authorization
- [x] `UNIT-TEST-MATH-INSERTION-1-29TPFK.P24` — capacity does not admit a nonparticipant author

## UNIT-TEST-SM-MATH-1-3TW0WT

Transitions and context

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d), [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1), [`REQ-SM-1-Y72CKX.T1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx.t1)

- [ ] `UNIT-TEST-SM-MATH-1-3TW0WT.P1` — `add` from the injected next writer updates deterministically and emits the expected ordered events/messages
- [ ] `UNIT-TEST-SM-MATH-1-3TW0WT.P2` — `add` from any other author rejects
- [ ] `UNIT-TEST-SM-MATH-1-3TW0WT.P3` — `leaveChannel` from the injected next writer updates deterministically and emits the expected ordered events/messages
- [ ] `UNIT-TEST-SM-MATH-1-3TW0WT.P4` — `leaveChannel` from any other author rejects

## UNIT-TEST-SM-MATH-2-TBFZ5Z

State codec

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-MATH-2-TBFZ5Z.P1` — An empty `MathState` round-trips exactly and preserves participant/balance array alignment
- [ ] `UNIT-TEST-SM-MATH-2-TBFZ5Z.P2` — a minimum `MathState` round-trips exactly
- [ ] `UNIT-TEST-SM-MATH-2-TBFZ5Z.P3` — a typical `MathState` round-trips exactly
- [ ] `UNIT-TEST-SM-MATH-2-TBFZ5Z.P4` — a maximum `MathState` round-trips exactly

## UNIT-TEST-SM-MATH-3-TS2Q90

Canonical representation

- Specification: [`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../../../../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr)
- Specification tests: [`REQ-SM-2-PHCRFR.T1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr.t1)

- [ ] `UNIT-TEST-SM-MATH-3-TS2Q90.P1` — Equivalent states encode identically
- [ ] `UNIT-TEST-SM-MATH-3-TS2Q90.P2` — malformed bytes reject
- [ ] `UNIT-TEST-SM-MATH-3-TS2Q90.P3` — incompatible shapes reject
- [ ] `UNIT-TEST-SM-MATH-3-TS2Q90.P4` — stale parallel-array data rejects

## UNIT-TEST-SM-MATH-4-04QW8S

Turn selection

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1)

- [ ] `UNIT-TEST-SM-MATH-4-04QW8S.P1` — An empty participant state returns the correct fallback author
- [ ] `UNIT-TEST-SM-MATH-4-04QW8S.P2` — a one-participant state returns the correct author
- [ ] `UNIT-TEST-SM-MATH-4-04QW8S.P3` — a many-participant state returns the correct author across a full modulo turn cycle
- [ ] `UNIT-TEST-SM-MATH-4-04QW8S.P4` — the correct author is returned after a membership change

## UNIT-TEST-SM-MATH-5-AYZHPG

Admission and top-up

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1)

- [x] `UNIT-TEST-SM-MATH-5-AYZHPG.P1` — New joins append once
- [ ] `UNIT-TEST-SM-MATH-5-AYZHPG.P2` — repeated joins update only the existing balance
- [ ] `UNIT-TEST-SM-MATH-5-AYZHPG.P3` — zero-value joins behave atomically
- [ ] `UNIT-TEST-SM-MATH-5-AYZHPG.P4` — max-value joins behave atomically
- [ ] `UNIT-TEST-SM-MATH-5-AYZHPG.P5` — join retries behave atomically
- [ ] `UNIT-TEST-SM-MATH-5-AYZHPG.P6` — joins against invalid states behave atomically

## UNIT-TEST-SM-MATH-6-37SRDX

Removal and slashing policy

- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [ ] `UNIT-TEST-SM-MATH-6-37SRDX.P1` — Existing-member removal adjusts the current index, returns the balance, and preserves aligned state
- [ ] `UNIT-TEST-SM-MATH-6-37SRDX.P2` — non-member removal preserves aligned state
- [ ] `UNIT-TEST-SM-MATH-6-37SRDX.P3` — slash delegation preserves aligned state
- [ ] `UNIT-TEST-SM-MATH-6-37SRDX.P4` — duplicate removal preserves aligned state
- [ ] `UNIT-TEST-SM-MATH-6-37SRDX.P5` — removal failure preserves aligned state

## UNIT-TEST-SM-MATH-7-YVYYNV

Simple-amount algebra

- Specification: [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v), [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b), [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-1-Z8RH4V.T1`](../../../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v.t1), [`REQ-BAL-2-KTSW9B.T1`](../../../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b.t1), [`REQ-BAL-3-P7Q83F.T1`](../../../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P1` — Zero-value addition has exact checked-arithmetic results
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P2` — boundary/max-value addition is exact
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P3` — subtraction is exact
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P4` — comparison is exact
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P5` — zero identity holds
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P6` — total aggregation is exact
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P7` — underflow rejects
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P8` — overflow rejects
- [ ] `UNIT-TEST-SM-MATH-7-YVYYNV.P9` — retry after rejection is exact

## UNIT-TEST-SM-MATH-8-2VRMCT

Application interface

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-MATH-8-2VRMCT.P1` — The transition operations match the base/adapter ABI
- [ ] `UNIT-TEST-SM-MATH-8-2VRMCT.P2` — the state codec operations match the base/adapter ABI
- [ ] `UNIT-TEST-SM-MATH-8-2VRMCT.P3` — the turn selector matches the base/adapter ABI
- [ ] `UNIT-TEST-SM-MATH-8-2VRMCT.P4` — the balance operations match the base/adapter ABI
- [ ] `UNIT-TEST-SM-MATH-8-2VRMCT.P5` — the membership/lifecycle operations match the base/adapter ABI
- [ ] `UNIT-TEST-SM-MATH-8-2VRMCT.P6` — read-only operations do not mutate state
