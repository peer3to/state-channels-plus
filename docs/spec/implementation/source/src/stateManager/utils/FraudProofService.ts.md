# FraudProofService.ts

> **Source:** [src/stateManager/utils/FraudProofService.ts](../../../../../../../src/stateManager/utils/FraudProofService.ts)

## Requirements

- [`REQ-BLOCK-PIPE-8-N529VH` (Evidence precedes escalation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-8-n529vh)

## UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18

Proof packaging

- Setup: Build each proof type from fixture deviations
- Oracle: Structs verify under the corresponding canonical handler; stored under content keys

- [ ] `UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P1` — double-sign proof round-trips through the mirrored handler
- [ ] `UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P2` — invalid-transition proof round-trips through the mirrored handler
- [ ] `UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P3` — wrong-genesis proof round-trips through the mirrored handler
- [ ] `UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P4` — invalid-timestamp proof round-trips through the mirrored handler
- [ ] `UNIT-TEST-FRAUD-PROOF-SERVICE-1-RF6J18.P5` — forged-inbound-block proof round-trips through the mirrored handler
