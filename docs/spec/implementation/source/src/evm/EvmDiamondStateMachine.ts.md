# EvmDiamondStateMachine.ts

> **Source:** [src/evm/EvmDiamondStateMachine.ts](../../../../../../src/evm/EvmDiamondStateMachine.ts)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
  Partial: [`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30) (recorded at the LocalDiamond report).
- [`REQ-ENFSM-1-DKJCY2` (Injected context, bounded gas)](../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-1-dkjcy2)
- [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- [`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr)
- [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v)
- [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b)
- [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)

## UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1

Mirror equivalence

- Setup: Evaluate window/proof predicates locally vs on-chain under controlled and drifted local time
- Oracle: Agreement under controlled context; drift produces detectably non-equivalent results

- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P1` — window-predicate agreement
- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P2` — time-drift divergence
- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P3` — replication convergence
- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P4` — proof-predicate agreement

## UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG

Invalid transition versus local failure

- Setup: Build `EvmDiamondStateMachine` over a Math machine on a real executor (inline, or SDK-owned with a corrupted request) and call `stateTransition` with a reverting, an under-funded and an executor-failed transition
- Oracle: Only the in-EVM revert returns an invalid result; the other two throw and leave the machine sum unchanged

- [x] `UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P1` — a transition that reverts inside the EVM returns `success: false` with no outbound messages
- [x] `UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P2` — a refusal to run under-funded is thrown, not returned as an invalid transition, and the transition does not run
- [x] `UNIT-TEST-EVM-DIAMOND-SM-2-D2B2BG.P3` — a failed executor connection is thrown, not returned as an invalid transition, and the transition does not run

## UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC

Local reduction outcome

- Setup: Teleport a session to an expired, unreduced dispute window, persist the chain window into the requester's local diamond, and call `reduceAndFinalizeLocally` with the served window inputs (altered per permutation)
- Oracle: The returned flag is true only when this call committed the reduction; the local window records the committed fork; a revert throws and commits nothing

- [x] `UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P1` — served inputs on an unreduced window return true and the local window records the expected fork
- [x] `UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P2` — a repeat on the window already reduced to the expected fork returns false and keeps that fork
- [x] `UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P3` — a repeat expecting another fork throws `RaceConditionReductionExpectationDoesntMatch` and keeps the committed fork
- [x] `UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P4` — disputes naming a fork without a dispute window return false and leave the local window unreduced
- [x] `UNIT-TEST-EVM-DIAMOND-SM-3-G1KMVC.P5` — an inbound list with a fabricated successor throws `ErrorDisputeInboundMessageBlocksInvalid` and leaves the local window unreduced

## UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC

ABI encoding/decoding

- Setup: Call each adapter method over a real `AContractExecutor` bound to a deployed state machine; the adapter encodes calldata with `contractInterface.encodeFunctionData`, sends mutations through `executeCall` and views through `simulateCall`, and decodes with `Codec.decodeEvmResult` or the ABI coder.
- Oracle: Each method sends its own function's selector and arguments, and returns the same values as the contract's direct call (`(bool, Message[])` for `stateTransition`, bytes for `getState`, address for the selectors, `BalanceStruct` fields for the balance methods, bool for `processInboundMessage`).
- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P1` — The transition method sends the correct selector/arguments and decodes its canonical result
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P2` — the state get/set methods encode and decode canonically
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P3` — the selector and view methods encode and decode canonically
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P4` — the balance methods encode and decode canonical struct results
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P5` — the inbound/lifecycle methods encode and decode canonically

## UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81

Transition result

- Setup: Call `stateTransition` with transactions that succeed with zero, one and many outbound messages, with one that reverts inside the EVM, and repeat each call from the same restored state.
- Oracle: Success returns `success: true` with the contract's messages in emitted order; an error that `isInvalidStateTransitionError` accepts returns `success: false`, no messages and a no-op `successCallback`; any other error (under-funded refusal, executor failure) is thrown; repeated calls return the same result.
- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P1` — Success with zero messages returns the exact contract classification
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P2` — success with one message returns the exact classification and message
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P3` — success with many messages preserves message order
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P4` — revert returns the exact contract classification
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P5` — repeat calls return consistent classifications

## UNIT-TEST-SM-EVM-ADAPTER-3-VNHPVK

Logs and callback

- Setup: Run a transition that emits several contract events with a `StateManager` set through `setStateManager`, then invoke `successCallback`; repeat with an `events.emit` that throws.
- Oracle: `contractEvents` is emitted once per parsed log, in log order, only when `successCallback` runs (unknown logs are skipped); an emit failure is logged as `Contract event emit failed` and neither throws nor changes `getState`.
- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-3-VNHPVK.P1` — Logs are processed once, only through the success callback for transitions, in emitted order
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-3-VNHPVK.P2` — callback failure is reported without changing state semantics

## UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z

Get/set state

- Setup: Call `setState` then `getState` with valid encoded states, then make the executor fail and make the returned bytes undecodable.
- Oracle: Valid states read back byte-for-byte; an executor or decode failure throws `StateMachineInterface.setState: …` or `StateMachineInterface.getState: …` and no bytes are returned.
- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z.P1` — Valid states round-trip
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z.P2` — executor failures carry operation context without producing fabricated bytes
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z.P3` — decode failures carry operation context without producing fabricated bytes

## UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW

Simulated next-writer query

- Setup: Call `peekNextToWrite(encodedState)` on a machine that holds a different live state: once with a state whose `getNextToWriteOf` succeeds, once with an undecodable state that makes it revert, and once while a replay holds the state mutex with its predecessor state installed.
- Oracle: `peekNextToWrite` sends one `getNextToWriteOf` simulated call and no `setState`; after each call `getState` equals the live state from before it; a revert throws `StateMachineInterface.peekNextToWrite: …`; under a held state mutex the call settles without the mutex and returns the next writer of the given state, not of the installed one.
- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [x] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P1` — the live state is unchanged after a successful call
- [x] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P4` — the live state is unchanged after a reverted `getNextToWriteOf`, and the call throws with operation context
- [x] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P5` — while a replay holds the state mutex with another state installed, the call settles without the mutex and returns the next writer of the given state

## UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT

Balance adapter

- Setup: Call `addBalance`, `subtractBalance` and `getTotalStateBalance` with in-range, underflowing and overflowing balances over the in-process `ContractExecutor` and the `RpcContractExecutor`.
- Oracle: Successful results equal the contract's `Balance` field for field under both executors; a contract rejection throws `StateMachineInterface.<method>: …` under both, with no result returned.
- Specification: [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v), [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b), [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-1-Z8RH4V.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v.t1), [`REQ-BAL-2-KTSW9B.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b.t1), [`REQ-BAL-3-P7Q83F.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT.P1` — `addBalance` preserves exact struct data and consistently propagates success/rejection across executor modes
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT.P2` — `subtractBalance` preserves exact struct data and consistently propagates success/rejection
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT.P3` — `getTotalStateBalance` preserves exact struct data and consistently propagates success/rejection

## UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR

Inbound/lifecycle operations

- Setup: Call `processInboundMessage` with join and custom messages, the read-only views `getParticipants`, `getNextToWrite` and `runView`, `getStateMachineAddress` and `dispose`, then repeat with a failing executor.
- Oracle: `processInboundMessage` returns the contract's bool, changes state through `executeCall` and publishes its logs; views leave `getState` unchanged; `getStateMachineAddress` returns the constructor address; `dispose` does nothing; failures throw `StateMachineInterface.<method>: …`, except `getParticipants`, which propagates the raw error.
- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty), [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1), [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P1` — Inbound mutation has correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P2` — read-only views have correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P3` — address reporting has correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P4` — disposal has correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P5` — operational failure has correct effects and contextual errors
