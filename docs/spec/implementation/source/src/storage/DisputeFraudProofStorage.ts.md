# DisputeFraudProofStorage.ts

> **Source:** [src/storage/DisputeFraudProofStorage.ts](../../../../../../src/storage/DisputeFraudProofStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DSTORE-3-ZNXSTM` (Content-addressed proofs with stable indexes)](../../../../specification/storage/dispute-evidence.md#req-dstore-3-znxstm)

## UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK

First-write-wins per dispute

- Setup: Store proofs for a dispute, then a different proof for the same dispute
- Oracle: First retained; second dropped; lookup by dispute exact

- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P1` — store/lookup
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P2` — second write dropped
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-STORAGE-1-WFRDHK.P3` — distinct disputes independent
