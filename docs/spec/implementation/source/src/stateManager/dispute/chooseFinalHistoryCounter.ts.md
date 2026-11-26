# chooseFinalHistoryCounter.ts

> **Source:** [src/stateManager/dispute/chooseFinalHistoryCounter.ts](../../../../../../../src/stateManager/dispute/chooseFinalHistoryCounter.ts)

## Requirements

- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)

Pure choice among accepted final-history counters against one dispute: the largest slash set that
fits one transaction's calldata limit, the earliest on a tie, and the largest overall when none fits
([`REQ-FP-7-4DD0D7.T11.P13`](../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7.t11.p13)).
