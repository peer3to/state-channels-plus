# chooseFinalHistoryCounter.test.ts

Test file: [test/unit/chooseFinalHistoryCounter.test.ts](../../../../../../test/unit/chooseFinalHistoryCounter.test.ts)

## Overview

Calls `chooseFinalHistoryCounter` with built counters of known slash sets and encoded sizes. Checks the largest fitting slash set wins, the earliest wins a tie, a counter too large to send loses to a smaller one that fits, and the largest is returned when none fits.

## Tests

- `no counter -> undefined`: REQ-FP-7-4DD0D7.T11.P13
- `two fitting counters -> the one that slashes more addresses, though it comes later`: REQ-FP-7-4DD0D7.T11.P13
- `two fitting counters with equal slash sets -> the earlier one`: REQ-FP-7-4DD0D7.T11.P13
- `the larger slash set does not fit one transaction -> the smaller one that fits`: REQ-FP-7-4DD0D7.T11.P13
- `no counter fits one transaction -> the one with the largest slash set, too large to send`: REQ-FP-7-4DD0D7.T11.P13
