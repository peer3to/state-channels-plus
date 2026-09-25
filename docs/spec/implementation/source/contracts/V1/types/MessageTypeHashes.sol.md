# MessageTypeHashes.sol

> **Source:** [contracts/V1/types/MessageTypeHashes.sol](../../../../../../../contracts/V1/types/MessageTypeHashes.sol)
>
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md)

## Requirements

- [`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs)

## UNIT-TEST-SM-MESSAGE-HASHES-1-40HWWB

Join discriminator

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1)

- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-1-40HWWB.P1` — The join constant equals the specified domain hash
- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-1-40HWWB.P2` — a join payload routes to the join decoder
- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-1-40HWWB.P3` — a non-join payload does not route to the join decoder

## UNIT-TEST-SM-MESSAGE-HASHES-2-RVBJRK

Exit discriminator

- Specification: [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-8-8CHSQ8.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-2-RVBJRK.P1` — A removal exit uses the exit constant
- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-2-RVBJRK.P2` — a slash exit uses the same exit constant
- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-2-RVBJRK.P3` — the exit constant is distinguishable from join/custom message types

## UNIT-TEST-SM-MESSAGE-HASHES-3-PJX2MA

Compatibility

- Specification: [`REQ-SM-7-Y38NTY` (\_joinChannel handles admission and top-up)](../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty), [`REQ-SM-8-8CHSQ8` (A successful slash or removal MUST return and record exactly one corresponding…)](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8)
- Specification tests: [`REQ-SM-7-Y38NTY.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-7-y38nty.t1), [`REQ-SM-8-8CHSQ8.T1`](../../../../../specification/protocol-model/state-machines.md#req-sm-8-8chsq8.t1)

- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-3-PJX2MA.P1` — Constants remain identical across producers/consumers
- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-3-PJX2MA.P2` — persisted messages are never reinterpreted
- [ ] `UNIT-TEST-SM-MESSAGE-HASHES-3-PJX2MA.P3` — replayed messages are never reinterpreted
