# ReductionComputationService.ts

> **Source:** [src/stateManager/reduction/ReductionComputationService.ts](../../../../../../../src/stateManager/reduction/ReductionComputationService.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DISPUTE-PIPE-3-PHE3SQ` (Deterministic reduction)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-3-phe3sq)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)

## UNIT-TEST-REDUCTION-COMPUTE-1-GNX0RP

Mirrored compute

- Setup: Compute over permuted committed sets
- Oracle: Identical successor for every order (documents the [`OQ-4-JGDCNX` (Dispute-reduction order-independence)](../../../../../verification/open-questions.md#oq-4-jgdcnx) caveat where it fails)

- [ ] `UNIT-TEST-REDUCTION-COMPUTE-1-GNX0RP.P1` — order permutations
- [ ] `UNIT-TEST-REDUCTION-COMPUTE-1-GNX0RP.P2` — genesis-claim disputes
- [ ] `UNIT-TEST-REDUCTION-COMPUTE-1-GNX0RP.P3` — committed set with a timeout dispute
- [ ] `UNIT-TEST-REDUCTION-COMPUTE-1-GNX0RP.P4` — committed set without a timeout dispute
