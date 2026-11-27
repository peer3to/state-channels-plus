# chooseFinalHistoryCounter.ts

> **Source:** [src/stateManager/dispute/chooseFinalHistoryCounter.ts](../../../../../../../src/stateManager/dispute/chooseFinalHistoryCounter.ts)

## Requirements

- [`REQ-FP-7-4DD0D7` (A valid dispute fraud proof applied within the kill period kills the committed…)](../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7)

## UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN

The chosen final-history counter follows slash-set size, list order, and the per-transaction calldata limit.

- Setup: Call `chooseFinalHistoryCounter` with built counters of known slash sets and kill sizes on both sides of the limit
- Oracle: The returned counter, by its name, or `undefined`

- [x] `UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P1` — no counter: `undefined`
- [x] `UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P2` — two fitting counters: the larger slash set wins, though it comes later
- [x] `UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P3` — two fitting counters with equal slash sets: the earlier one
- [x] `UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P4` — the larger slash set does not fit the limit: the smaller one that fits
- [x] `UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P5` — no counter fits: the one with the largest slash set
