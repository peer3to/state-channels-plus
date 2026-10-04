# src/stateManager/utils — Subsystem

> **Status:** Skeleton — subsystem responsibility, design, assumptions, interactions, and
> integration obligations pending authoring.

_Pending authoring: shared responsibility, design decisions, assumptions, cross-file interactions, and integration obligations of this subsystem._

## Contents

- [FraudProofService.ts](./FraudProofService.ts.md)

## Fraud proofs from the predecessor

[FraudProofService](FraudProofService.ts.md) builds the invalid-transition and invalid-timestamp proofs
from the predecessor that dispute replay passes; only live gossip reads it from storage, and only
there a missing predecessor yields no proof ([`REQ-DISPUTE-PIPE-5-RZZB48` (Mirrored canonical audit)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-rzzb48)).
