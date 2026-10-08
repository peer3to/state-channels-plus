# ValidationServicePrunedHistory.test.ts

Test file: [test/unit/ValidationServicePrunedHistory.test.ts](../../../../../../test/unit/ValidationServicePrunedHistory.test.ts)

## Overview

Validates incoming blocks around missing compacted history. Checks NOT_READY without accusation for an empty older slot and preserves normal validation for eligible history.

## Tests

- `live strategy, no predecessor, free height below the next height → NOT_READY, dropped through the strategy hook without a disconnect`: REQ-BLOCK-PIPE-2-PCXNT6.T2.P1, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P31
- `live strategy, a stored block at the same height → still the conflict path: conflictingButNotLinkedBlockDetected → DISCONNECT`: REQ-BLOCK-PIPE-2-PCXNT6.T2.P2, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P32
- `live strategy, an unlinked block at the next height → still blockIsNotLinkedAndIsNotFirstBlock → DISCONNECT`: REQ-BLOCK-PIPE-2-PCXNT6.T2.P3, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P33
- `dispute replay (no live gates) at a free height below the next height → not dropped by the live free-height rule, validation reaches the linkage guard`: REQ-BLOCK-PIPE-3-WW2SB7.T2.P1, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P34
