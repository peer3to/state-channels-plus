# AStateMachine.sol

> **Source:** [contracts/V1/AStateMachine.sol](../../../../../../contracts/V1/AStateMachine.sol)
>
> **Design views:** [architecture/contracts/state-machine-base.md](../../../views/architecture/contracts/state-machine-base.md)

## Requirements

- [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
  Partial: `stateTransition` stores only `_tx.header` and leaves `_tx.body` empty ([`OQ-21-PEZK9X` (`_tx.body` population and state-encoding versioning)](../../../open-questions.md#oq-21-pezk9x)); keeping ambient EVM context out of the integrator's transition logic is integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr)
  Partial: canonical serialization in the integrator's `getState`/`_setState` is integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- [`INV-ENFSM-1-762ACD` (Replay from supplied state only)](../../../../specification/enforcement/execution-and-consumer.md#inv-enfsm-1-762acd)
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- [`REQ-SM-10-JD8TSF` (Slashing or removal of a participant absent from the state being transformed…)](../../../../specification/protocol-model/state-machines.md#req-sm-10-jd8tsf)
- [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
  Partial: determinism of the integrator logic `stateTransition` calls is integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
  Partial: the `getState`/`_setState` round-trip is integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-SM-3-88RFP2` (Mappings only with complete deterministic key enumeration)](../../../../specification/protocol-model/state-machines.md#req-sm-3-88rfp2)
  Partial: complete mapping enumeration in the integrator's `getState` is integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v)
  Partial: underflow rejection in the integrator's `subtractBalance` is integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b)
- [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
  Partial: admission and top-up in the integrator's `_joinChannel` are integrator-owned and not generically enforced ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
  Partial: state-machine diamonds MUST route `getNextToWriteOf(bytes)`; it sets the given state and must only be called as a simulated call. An unrouted selector makes every timeout audit throw (`EvmDiamondStateMachine.peekNextToWrite`). Routing is integrator-owned and not checked ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).
- [`REQ-FIN-5-DH29VZ` (Block authoring is deterministic)](../../../../specification/protocol-model/finality.md#req-fin-5-dh29vz)
- [`REQ-LIF-3-PDRTPY` (A normal state transition MAY produce an outbound message)](../../../../specification/settlement/lifecycle.md#req-lif-3-pdrtpy)
- [`INV-DIS-7-9GGZSD` (In a fork whose reduction applies an on-chain slash of a participant of the…)](../../../../specification/disputes/disputes.md#inv-dis-7-9ggzsd)
  Partial: `_slashParticipant` must return true for every current participant, because dispute reduction adds the timeout target to the removals only when no slash took effect; the contract is integrator-owned and not enforced, so a machine that returns false for a present participant also removes the timeout target and inverts the slash precedence for that machine ([`FIND-INTEGRATOR-1-5MF8N9`](../../../../audit/open-findings.md#find-integrator-1-5mf8n9)).

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

## UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF

Transition runs only with its full budget

- Setup: Restore a Math state, then call `stateTransition` directly with gas below the requirement, exactly `gasLimit`, exactly `getStateTransitionGasRequirement()`, and ample gas; on a cheap `add`, a never-finishing `burn`, a `guardedAdd` that catches an inner out-of-gas, a bare `revert()`, and a revert with a reason
- Oracle: Below the requirement every transition reverts with `ErrorInsufficientGasForStateTransition` and state is unchanged; funded, `add` and `guardedAdd` change the sum by one, `burn` and a bare revert revert with "result length 0", and a reason is re-raised unchanged

- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P1` — a transition that runs out of gas, called with less gas than its requirement, is refused with `ErrorInsufficientGasForStateTransition`
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P2` — a cheap transition called with less gas than its requirement is refused before it runs and changes no state
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P3` — a funded transition that runs out of gas within the full budget reverts with "result length 0"
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P4` — exactly `getStateTransitionGasRequirement()` attached runs the transition
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P5` — exactly `gasLimit` attached is refused (EIP-150 keeps 1/64 in the caller)
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P6` — a funded transition that catches an inner out-of-gas takes its full-budget branch
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P7` — a transition that catches an inner out-of-gas, under-funded, is refused
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P8` — a funded bare `revert()` (empty returndata) reverts with "result length 0"
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P9` — a funded transition's own revert reason is re-raised unchanged
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P11` — a transition that emits fewer messages than the previous one reports only its own messages, and `getOutboundMessages` returns only those
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P12` — for any call-input size up to 128 KiB and any attached gas around the requirement, a transition that runs is granted its full budget
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P13` — after a transition that left many outbound messages, with the machine's storage cold, a transition funded with only its requirement is refused with `ErrorInsufficientGasForStateTransition` (the deletion is not paid from the requirement), and funded for the deletion as well it runs on its full budget and reports no messages
- [x] `UNIT-TEST-ASTATE-MACHINE-2-Z2XXMF.P14` — the same message-producing transition, run after no previous messages, after a few very long ones and after a few short ones (storage cold each time), returns the same messages and never spends more than on empty storage

## UNIT-TEST-SM-ASTATE-1-S1YSJG

Transition orchestration

- Setup: Restore a Math state with `setState`, run a transition that leaves outbound messages, then call a funded `stateTransition` whose `body.data` dispatches a transition emitting zero, one or many messages.
- Oracle: The call returns `(true, messages)` where `messages` equal `getOutboundMessages()` and hold only this transition's messages in emission order; the previous transition's messages are gone.
- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-ASTATE-1-S1YSJG.P1` — Clear prior messages, inject the header, enforce the gas budget, dispatch calldata, and return success with zero outbound messages
- [ ] `UNIT-TEST-SM-ASTATE-1-S1YSJG.P2` — a successful transition returns one outbound message
- [ ] `UNIT-TEST-SM-ASTATE-1-S1YSJG.P3` — a successful transition returns many outbound messages in order

## UNIT-TEST-SM-ASTATE-2-X06ZXW

Transition rejection

- Setup: After a transition that changed state and left outbound messages, call a funded `stateTransition` whose dispatched function reverts with a reason or with empty returndata.
- Oracle: `stateTransition` reverts, re-raising the reason unchanged or reverting with "AStateMachine - Call failed - result length 0", and `getState()` and `getOutboundMessages()` equal their values from before the call.
- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-ASTATE-2-X06ZXW.P1` — A revert with data rejects deterministically and exposes neither partial state nor partial outbound messages
- [ ] `UNIT-TEST-SM-ASTATE-2-X06ZXW.P2` — a revert without data rejects with the same guarantees

## UNIT-TEST-SM-ASTATE-3-W1VEFR

Injected execution context

- Setup: Run the same `stateTransition` on a concrete subclass while varying `transaction.header.participant` and `timestamp`, the ambient EVM context (`msg.sender`, `block.timestamp`, `block.number`), and the `transaction.body` fields other than `data`.
- Oracle: Only the header participant and time and the dispatched arguments change the resulting `getState()` and outbound messages; ambient and `_tx.body` changes leave both byte-identical. The base contract has no check that rejects ambient reads, so the oracle is asserted per concrete subclass.
- Specification: [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
- Specification tests: [`REQ-SM-1-Y72CKX.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx.t1)

- [ ] `UNIT-TEST-SM-ASTATE-3-W1VEFR.P1` — Only the injected participant/time and dispatched arguments affect application behavior
- [ ] `UNIT-TEST-SM-ASTATE-3-W1VEFR.P2` — ambient EVM values do not
- [ ] `UNIT-TEST-SM-ASTATE-3-W1VEFR.P3` — `_tx.body` does not

## UNIT-TEST-SM-ASTATE-4-25RMFZ

State boundary

- Setup: Call `setState` on a concrete subclass with encodings taken from `getState()` of known states, then with truncated bytes and a differently shaped encoding.
- Oracle: A valid encoding makes `getState()` return the supplied bytes exactly; a malformed encoding reverts in `_setState` and `getState()` keeps its previous bytes.
- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-ASTATE-4-25RMFZ.P1` — Concrete subclasses round-trip valid states through `setState`/`getState`
- [ ] `UNIT-TEST-SM-ASTATE-4-25RMFZ.P2` — malformed encodings reject without partial mutation through `setState`

## UNIT-TEST-SM-ASTATE-5-HYC257

Inbound dispatch

- Setup: Call `processInboundMessage` with a `MESSAGE_TYPE_JOIN` message carrying an encoded `JoinChannel`, a custom message type and an unknown type, against hooks that return false or revert.
- Oracle: A join message is decoded and handed to `_joinChannel`, so the joiner appears in `getParticipants()` with its deposited balance; every other type reaches only `_processCustomInboundMessage` (the base returns false), and a false or reverting hook leaves `getState()` unchanged.
- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1)

- [x] `UNIT-TEST-SM-ASTATE-5-HYC257.P1` — Join messages decode and reach `_joinChannel`
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P2` — custom messages reach only the custom hook
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P3` — hook-false paths are atomic
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P4` — unknown-type messages reach only the custom hook
- [ ] `UNIT-TEST-SM-ASTATE-5-HYC257.P5` — hook-revert paths are atomic

## UNIT-TEST-SM-ASTATE-6-KJSK5V

Removal and slashing wrappers

- Setup: On a Math state, call `removeParticipant` and `slashParticipant` for a present target, an absent target, and the same target a second time.
- Oracle: A successful call returns `(true, exit)` and appends exactly one `MESSAGE_TYPE_EXIT` message whose participant and balance equal the returned exit; an absent or repeated target returns `false` with an empty exit, appends no message and leaves `getState()` unchanged.
- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P1` — Equivalent successful removal and slashing produce one canonical exit message
- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P2` — successful removal records its returned exit exactly once
- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P3` — wrapper failure does not leak state or messages
- [ ] `UNIT-TEST-SM-ASTATE-6-KJSK5V.P4` — retry after failure does not leak state or messages

## UNIT-TEST-SM-ASTATE-7-BMXBKT

Complete public interface

- Setup: Call every public entry point of a concrete subclass (`stateTransition`, `setState`/`getState`, the balance functions, `getNextToWrite`, `processInboundMessage`/`joinChannel`, `removeParticipant`/`slashParticipant`) with canonical and rejected inputs.
- Oracle: Each entry point exists with its declared mutability, equal inputs give equal results, and a rejected input reverts without changing `getState()` or `getOutboundMessages()`.
- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P1` — The transition entry point is callable with canonical inputs, correct mutability, deterministic rejection, and no undeclared side effects
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P2` — the state hooks satisfy the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P3` — the balance hooks satisfy the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P4` — the next-writer selector satisfies the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P5` — inbound dispatch satisfies the same oracle
- [ ] `UNIT-TEST-SM-ASTATE-7-BMXBKT.P6` — the removal/slashing wrappers satisfy the same oracle
