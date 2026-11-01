# StorageDiffSnapshotStatus.test.ts

Test file: [test/utils/node/StorageDiffSnapshotStatus.test.ts](../../../../../../../test/utils/node/StorageDiffSnapshotStatus.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases subscribe against an isolated anvil test chain, and against a scripted Substrate child trie node where the child trie matters. They check the status of the subscribe answer, the lazy notice, the logged warnings with both counts, the delay notice after a reorg and the upstream request counts.

## Tests

- `says syncing for an account it still has to backfill, and ready once the account is complete`: REQ-SDS-9-ZRPZZW.T1.P9
- `tells a subscriber that a snapshot it was promised as ready is delayed when a reorg clears the cache`: REQ-SDS-12-N40MKR.T1.P9
- `keeps an account lazy and warns with both counts when the chain holds more entries than the history named`: REQ-SDS-9-ZRPZZW.T1.P10, REQ-SDS-9-ZRPZZW.T1.P11
- `tells a subscriber of a lazy account that no snapshot is coming also when it subscribes after the backfill`: REQ-SDS-9-ZRPZZW.T1.P12
- `tells the subscriber at once when the backfill fails`: REQ-SDS-9-ZRPZZW.T1.P13
- `does not backfill a lazy account again when it is subscribed again`: REQ-SDS-9-ZRPZZW.T1.P14
- `pushes the snapshot and answers every slot from the cache when the chain holds just the entries the history named`: REQ-SDS-9-ZRPZZW.T1.P15
- `keeps an account lazy and tells its subscriber when a block's trace omits a write the chain holds`: REQ-SDS-9-ZRPZZW.T1.P16
- `keeps an account complete when the count after a write matches, at the cost of one hash read and one key page`: REQ-SDS-9-ZRPZZW.T1.P17
