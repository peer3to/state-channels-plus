# Block.ts

> **Source:** [src/models/Block.ts](../../../../../../src/models/Block.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-DATA-1-1KNRQS` (Decoders reject malformed, truncated, trailing, out-of-range, wrong-tag, and…)](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs)
- [`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)

## UNIT-TEST-BLOCK-MODEL-1-037DM6

Model semantics

- Setup: Round-trip, expand with dup/malleated signatures, compute relevant timestamps both ways
- Oracle: Byte-exact round trips; dedup by signer; timestamp selection per posting state

- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P1` — round trip
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P2` — duplicate-signature dedup
- [ ] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P3` — didEveryoneSign unions
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P4` — author-signed relevant timestamp
- [ ] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P5` — malleated-signature dedup
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P6` — posted relevant timestamp
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P7` — equivalent byte representations share one recovery-cache entry
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P8` — merge uses canonical equality and keeps its original author envelope
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P9` — struct construction and author re-signing normalize real signer output
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P10` — constructors deduplicate hex casing and byte-array confirmations
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P11` — expansion and removal use the same byte equality
- [x] `UNIT-TEST-BLOCK-MODEL-1-037DM6.P12` — keeps malformed envelopes unchanged for authentication failure

## UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR

Same-block copy merge

- Setup: Merge factory-built copies through Block.mergeFrom and inspect the confirmation signature set and defined/undefined timestamp policy.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P1` — mergeFrom preserves a defined timestamp when the incoming copy has none
- [x] `UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P2` — mergeFrom accepts a zero timestamp from the incoming copy
