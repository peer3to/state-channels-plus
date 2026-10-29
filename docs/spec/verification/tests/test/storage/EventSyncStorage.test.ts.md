# EventSyncStorage.test.ts

Test file: [test/storage/EventSyncStorage.test.ts](../../../../../../test/storage/EventSyncStorage.test.ts)
Exercises: [EventSyncStorage.ts](../../../../implementation/source/src/storage/EventSyncStorage.ts.md)

## Overview

Two tests drive `EventSyncStorage` directly. The first stores watermarks for two channels —
including a lower value delivered under a case-variant of the first channel's id — and asserts
each channel reads back its own highest value, demonstrating per-channel isolation and that the
regression written through the normalized key is ignored. The second asserts a channel with no
stores reads back `undefined`. The key normalization itself is not independently discriminated
(that would need a variant-keyed higher store read back through the original key), and no test
advances a channel's watermark across successive increasing stores, so the case-unification and
advance permutations stay unassigned.

## Tests

- `stores independent monotonic watermarks per normalized channel`: REQ-RMSTORE-1-BWKVBG.T1.P2, REQ-RMSTORE-1-BWKVBG.T1.P3, UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P2, UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P4
- `has no cursor until an event-bearing block is published`: none
