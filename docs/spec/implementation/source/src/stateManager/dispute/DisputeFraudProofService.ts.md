# DisputeFraudProofService.ts

> **Source:** [src/stateManager/dispute/DisputeFraudProofService.ts](../../../../../../../src/stateManager/dispute/DisputeFraudProofService.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)

## UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0

Family packaging

- Setup: Build each family from fixtures
- Oracle: Each struct verifies under its canonical handler; one per dispute

- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P1` — invalid-state-proof family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P2` — one-per-dispute discipline
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P3` — invalid-block-structure family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P4` — state-proof-header-mismatch family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P5` — invalid-block-in-state-proof family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P6` — inbound-hash-not-in-chain family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P7` — slashes-not-subset family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P8` — balance-invariant family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P9` — not-latest-state family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P10` — invalid-output-state family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P11` — block-author-not-participant family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P12` — last-milestone-not-final-without-auditing-data family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P13` — invalid-dispute-reason family
- [ ] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P14` — timeout-threshold family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P15` — timeout-not-linked family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P16` — timeout-participant-not-next family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P17` — timeout-too-early family
- [x] `UNIT-TEST-DISPUTE-FRAUD-PROOF-SERVICE-1-ZVPVC0.P18` — timeout-calldata-posted family
