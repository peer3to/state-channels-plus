# FraudProofStorage.ts

> **Source:** [src/storage/FraudProofStorage.ts](../../../../../../src/storage/FraudProofStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DSTORE-3-ZNXSTM` (Content-addressed proofs with stable indexes)](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm)

## UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS

Store and index

- Setup: Store proofs incl. repeats and multiple per participant
- Oracle: Round trips exact; repeats idempotent; index returns a stored proof for exactly the indexed participants; index survives a re-store under a differing participant

- [x] `UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P1` — store/read by hash
- [x] `UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P2` — repeat idempotent
- [x] `UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P3` — multiple proofs one participant
- [x] `UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P4` — unindexed participant absent
- [x] `UNIT-TEST-FRAUD-PROOF-STORAGE-1-XJAHWS.P5` — index consistency on hash collision with a differing participant
