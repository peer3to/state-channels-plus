# EvmDiamondStateMachine.ts

> **Source:** [src/evm/EvmDiamondStateMachine.ts](../../../../../../src/evm/EvmDiamondStateMachine.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md), [architecture/sdk/architecture.md](../../../views/architecture/sdk/architecture.md)

## Requirements

- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)
- [`REQ-MIRROR-2-E9F3TM` (Unconditional replication)](../../../../specification/enforcement/local-mirror.md#req-mirror-2-e9f3tm)
  Partial: [`DEF-3-1XWQ30`](../../../../audit/open-findings.md#def-3-1xwq30) (recorded at the LocalDiamond report).
- [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
  Partial: Determinism of arbitrary integrator logic is not enforced; the generic cross-runtime replay-equivalence harness is missing.
- [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
  Partial: Interface and concrete Math codec implemented; general conformance pending — No generic round-trip harness exists, and `peekNextToWrite` does not restore live state when its temporary query throws.
- [`REQ-SM-2-PHCRFR` (Canonical, deterministic, lossless serialization)](../../../../specification/protocol-model/state-machines.md#req-sm-2-phcrfr)
  Partial: Interface implemented; integrator conformance pending — Canonical field/collection ordering is application-defined and neither statically checked nor generically tested.
- [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v)
  Partial: Interface and simple-amount implementation present; custom algebra pending — Arbitrary `Balance.data` algebras remain integrator-owned and have no reusable conformance harness.
- [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b)
  Partial: Interface implemented; integrator conformance pending — Solidity mutability constrains state writes but does not prove canonical custom-data semantics or cross-runtime determinism.
- [`REQ-SM-5-3GS7A7` (getNextToWrite authorizes the next block author)](../../../../specification/protocol-model/state-machines.md#req-sm-5-3gs7a7)
- [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
  Partial: Dispatch and concrete admission/top-up implemented; general conformance pending — The Math path demonstrates the required behavior, but no generic conformance suite proves it for another application contract.
- [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
  Partial: Interface split across contract and local adapter; engineer audit pending — Interface presence is visible in source, but completeness, atomic failure, and semantic equivalence have not been audited operation by operation.

## UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1

Mirror equivalence

- Setup: Evaluate window/proof predicates locally vs on-chain under controlled and drifted local time
- Oracle: Agreement under controlled context; drift produces detectably non-equivalent results

- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P1` — window-predicate agreement
- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P2` — time-drift divergence
- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P3` — replication convergence
- [ ] `UNIT-TEST-EVM-DIAMOND-SM-1-Q8XJV1.P4` — proof-predicate agreement

## UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC

ABI encoding/decoding

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P1` — The transition method sends the correct selector/arguments and decodes its canonical result
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P2` — the state get/set methods encode and decode canonically
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P3` — the selector and view methods encode and decode canonically
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P4` — the balance methods encode and decode canonical struct results
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-1-4TTJSC.P5` — the inbound/lifecycle methods encode and decode canonically

## UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81

Transition result

- Specification: [`INV-SM-1-J7BP6D` (Transitions deterministic)](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d)
- Specification tests: [`INV-SM-1-J7BP6D.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-1-j7bp6d.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P1` — Success with zero messages returns the exact contract classification
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P2` — success with one message returns the exact classification and message
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P3` — success with many messages preserves message order
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P4` — revert returns the exact contract classification
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-2-DB3G81.P5` — repeat calls return consistent classifications

## UNIT-TEST-SM-EVM-ADAPTER-3-VNHPVK

Logs and callback

- Specification: [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-3-VNHPVK.P1` — Logs are processed once, only through the success callback for transitions, in emitted order
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-3-VNHPVK.P2` — callback failure is reported without changing state semantics

## UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z

Get/set state

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z.P1` — Valid states round-trip
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z.P2` — executor failures carry operation context without producing fabricated bytes
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-4-XP8N5Z.P3` — decode failures carry operation context without producing fabricated bytes

## UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW

Temporary next-writer query

- Specification: [`INV-SM-2-0FTJ2T` (getState/\_setState exact inverses)](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t)
- Specification tests: [`INV-SM-2-0FTJ2T.T1`](../../../../specification/protocol-model/state-machines.md#inv-sm-2-0ftj2t.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P1` — Live state is restored after success
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P2` — the selector-failure case currently exposes the missing `finally`
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P3` — live state is restored after temporary-set failure
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-5-ZH1AXW.P4` — live state is restored after selector failure

## UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT

Balance adapter

- Specification: [`REQ-BAL-1-Z8RH4V` (subtractBalance rejects underflow)](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v), [`REQ-BAL-2-KTSW9B` (Balance operations pure/deterministic)](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b), [`REQ-BAL-3-P7Q83F` (addBalance and aggregations reject overflow)](../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f)
- Specification tests: [`REQ-BAL-1-Z8RH4V.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-1-z8rh4v.t1), [`REQ-BAL-2-KTSW9B.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-2-ktsw9b.t1), [`REQ-BAL-3-P7Q83F.T1`](../../../../specification/protocol-model/state-machines.md#req-bal-3-p7q83f.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT.P1` — `addBalance` preserves exact struct data and consistently propagates success/rejection across executor modes
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT.P2` — `subtractBalance` preserves exact struct data and consistently propagates success/rejection
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-6-QATHFT.P3` — `getTotalStateBalance` preserves exact struct data and consistently propagates success/rejection

## UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR

Inbound/lifecycle operations

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty), [`REQ-SM-9-QK86SJ` (A conforming state machine MUST provide the complete interface above)](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1), [`REQ-SM-9-QK86SJ.T1`](../../../../specification/protocol-model/state-machines.md#req-sm-9-qk86sj.t1)

- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P1` — Inbound mutation has correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P2` — read-only views have correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P3` — address reporting has correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P4` — disposal has correct effects and contextual errors
- [ ] `UNIT-TEST-SM-EVM-ADAPTER-7-4GJWQR.P5` — operational failure has correct effects and contextual errors
