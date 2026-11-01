# StorageDiffPersistedCache.test.ts

Test file: [test/utils/node/StorageDiffPersistedCache.test.ts](../../../../../../../test/utils/node/StorageDiffPersistedCache.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases start a service with a cache directory, stop it, change the chain and start another; the oracles are the snapshot the restarted service pushes and that it backfills nothing again.

## Tests

- `resumes a complete contract from disk without reading its history again`: REQ-SDS-10-F01BMA.T1.P1
- `rolls the saved cache back when the saved head is no longer on the chain, then catches up`: REQ-SDS-10-F01BMA.T1.P2
- `applies the blocks mined while the service was down`: REQ-SDS-10-F01BMA.T1.P3
