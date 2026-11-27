# chooseFinalHistoryCounter.test.ts

Test file: [test/unit/chooseFinalHistoryCounter.test.ts](../../../../../../test/unit/chooseFinalHistoryCounter.test.ts)
Exercises: [chooseFinalHistoryCounter.ts](../../../../implementation/source/src/stateManager/dispute/chooseFinalHistoryCounter.ts.md)

## Overview

Calls `chooseFinalHistoryCounter` with built counters of known slash sets and encoded sizes. Checks the largest fitting slash set wins, the earliest wins a tie, a counter too large to send loses to a smaller one that fits, and the largest is returned when none fits.

## Tests

- `no counter -> undefined`: UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P1
- `two fitting counters -> the one that slashes more addresses, though it comes later`: UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P2
- `two fitting counters with equal slash sets -> the earlier one`: UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P3
- `the larger slash set does not fit one transaction -> the smaller one that fits`: UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P4
- `no counter fits one transaction -> the one with the largest slash set, too large to send`: UNIT-TEST-CHOOSE-FINAL-HISTORY-COUNTER-1-XDC8KN.P5
