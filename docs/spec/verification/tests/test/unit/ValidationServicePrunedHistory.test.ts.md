# ValidationServicePrunedHistory.test.ts

Test file: [test/unit/ValidationServicePrunedHistory.test.ts](../../../../../../test/unit/ValidationServicePrunedHistory.test.ts)

## Overview

Validates incoming blocks around missing compacted history. A retained different block below the next height still takes the conflict path, and an unlinked block at the next height still takes the linkage path. An empty older height never reaches validation; its cases live in the BlockQueueManager suite.

## Tests

- `live strategy, a stored block at the same height → still the conflict path: conflictingButNotLinkedBlockDetected → DISCONNECT`: REQ-BLOCK-PIPE-2-PCXNT6.T2.P2, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P32
- `live strategy, an unlinked block at the next height → still blockIsNotLinkedAndIsNotFirstBlock → DISCONNECT`: REQ-BLOCK-PIPE-2-PCXNT6.T2.P3, UNIT-TEST-VALIDATION-SERVICE-1-3EJ7YV.P33
