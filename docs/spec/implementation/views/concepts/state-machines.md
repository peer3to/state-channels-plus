# State Machines — Implementation

> **Specification subject:** [specification/protocol-model/state-machines.md](../../../specification/protocol-model/state-machines.md)

## INTEGRATION-TEST-SM-1-5QXMFK

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d), [`REQ-SM-1-Y72CKX` (Author = \_tx.header.participant, time = \_tx.header.timestamp)](../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1), [`REQ-SM-1-Y72CKX.T1`](../../../specification/protocol-model/state-machines.md#req-sm-1-y72ckx.t1)
- Setup: Drive one transition through `StateManager`, the EVM adapter, the application contract, state persistence, and block-result construction without crossing a peer or base-layer boundary.
- Oracle: The subsystem commits exactly the contract result and ordered outbound messages; rejection advances no state, queue, or snapshot.

- [ ] `INTEGRATION-TEST-SM-1-5QXMFK.P2` — application revert
- [ ] `INTEGRATION-TEST-SM-1-5QXMFK.P3` — executor failure
- [ ] `INTEGRATION-TEST-SM-1-5QXMFK.P4` — zero outbound messages
- [ ] `INTEGRATION-TEST-SM-1-5QXMFK.P5` — retry after rejection
- [ ] `INTEGRATION-TEST-SM-1-5QXMFK.P6` — one outbound message
- [ ] `INTEGRATION-TEST-SM-1-5QXMFK.P7` — many outbound messages

## INTEGRATION-TEST-SM-2-BD2TK6

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t), [`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr), [`REQ-SM-4-Z32M0W` (Ordering/encoding/round-trip defined explicitly)](../../../specification/protocol-model/state-machines.md#req-sm-4-z32m0w)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1), [`REQ-SM-2-PHCRFR.T1`](../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr.t1), [`REQ-SM-4-Z32M0W.T1`](../../../specification/protocol-model/state-machines.md#req-sm-4-z32m0w.t1)
- Setup: Move serialized state among the live adapter, state storage, temporary next-writer inspection, and the separate replay instance.
- Oracle: Each consumer sees identical bytes and logical state; temporary and replay work cannot mutate the live instance.

- [ ] `INTEGRATION-TEST-SM-2-BD2TK6.P1` — store/restore
- [ ] `INTEGRATION-TEST-SM-2-BD2TK6.P2` — temporary query success
- [ ] `INTEGRATION-TEST-SM-2-BD2TK6.P3` — temporary query failure
- [ ] `INTEGRATION-TEST-SM-2-BD2TK6.P4` — replay success
- [ ] `INTEGRATION-TEST-SM-2-BD2TK6.P5` — concurrent live and replay work
- [ ] `INTEGRATION-TEST-SM-2-BD2TK6.P6` — replay revert

## INTEGRATION-TEST-SM-3-50P2GY

- Specification: [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v), [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b), [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-1-Z8RH4V.T1`](../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v.t1), [`REQ-BAL-2-KTSW9B.T1`](../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b.t1), [`REQ-BAL-3-P7Q83F.T1`](../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)
- Setup: Compose adapter balance operations with state-manager inbound/outbound accounting and snapshot totals.
- Oracle: Every internal aggregate agrees with application balance semantics and arithmetic rejection leaves subsystem state unchanged.

- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P1` — join
- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P2` — normal transition
- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P3` — remove
- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P4` — underflow
- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P6` — top-up
- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P7` — slash
- [ ] `INTEGRATION-TEST-SM-3-50P2GY.P8` — overflow

## INTEGRATION-TEST-SM-4-FH8YPT

- Specification: [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7), [`REQ-SM-6-BJZVQ5` (Turn authorization enforced generically at the protocol layer)](../../../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5)
- Specification tests: [`REQ-SM-5-3GS7A7.T1`](../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7.t1), [`REQ-SM-6-BJZVQ5.T1`](../../../specification/protocol-model/state-machines.md#req-sm-6-bjzvq5.t1)
- Setup: Compose selector queries with validation strategies and transition scheduling against the same pre-state.
- Oracle: Every strategy makes the same author decision before execution and preserves its own required deviation side effect.

- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P1` — correct author
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P2` — wrong author
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P3` — live strategy
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P4` — membership changed before validation
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P5` — selector failure
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P6` — non-member author
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P7` — stored strategy
- [ ] `INTEGRATION-TEST-SM-4-FH8YPT.P8` — spectating strategy

## INTEGRATION-TEST-SM-5-W15FWG

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1)
- Setup: Process an inbound join/custom message through state-manager selection, adapter dispatch, application mutation, persistence, and snapshot construction.
- Oracle: Membership, balance, state bytes, and inbound cursor advance together exactly once.

- [ ] `INTEGRATION-TEST-SM-5-W15FWG.P1` — new join
- [ ] `INTEGRATION-TEST-SM-5-W15FWG.P2` — top-up
- [ ] `INTEGRATION-TEST-SM-5-W15FWG.P3` — custom type
- [ ] `INTEGRATION-TEST-SM-5-W15FWG.P5` — hook failure and recovery
- [ ] `INTEGRATION-TEST-SM-5-W15FWG.P6` — unknown type

## INTEGRATION-TEST-SM-6-7PZZCS

- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)
- Setup: Compose removal/slashing hooks, wrapper/facet handling, outbound collection, state persistence, and withdrawal aggregation.
- Oracle: Equivalent exits remain equivalent across components; failure cannot partially mutate state or totals.

- [ ] `INTEGRATION-TEST-SM-6-7PZZCS.P1` — remove
- [ ] `INTEGRATION-TEST-SM-6-7PZZCS.P2` — slash
- [ ] `INTEGRATION-TEST-SM-6-7PZZCS.P3` — hook false
- [ ] `INTEGRATION-TEST-SM-6-7PZZCS.P4` — prior outbound messages
- [ ] `INTEGRATION-TEST-SM-6-7PZZCS.P6` — hook revert

## INTEGRATION-TEST-SM-7-1Y3WKE

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)
- Setup: Exercise the full SDK interface as consumed by validation, state management, persistence, and replay components.
- Oracle: No caller depends on behavior omitted or changed by the adapter; lifecycle and failure semantics remain consistent across the subsystem.

- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P1` — initialize
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P2` — execute
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P3` — state operations
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P4` — balance operations
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P5` — inbound operations
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P6` — operational failure and recovery
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P7` — dispose
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P8` — query
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P9` — selector operations
- [ ] `INTEGRATION-TEST-SM-7-1Y3WKE.P10` — outbound operations
