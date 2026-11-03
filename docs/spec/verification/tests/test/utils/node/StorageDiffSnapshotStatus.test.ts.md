# StorageDiffSnapshotStatus.test.ts

Test file: [test/utils/node/StorageDiffSnapshotStatus.test.ts](../../../../../../../test/utils/node/StorageDiffSnapshotStatus.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases subscribe against an isolated anvil test chain, and against a scripted Substrate child trie node where the child trie matters. The scripted node also lags the upstream for a while, holds no contract for an account without code, fails or holds key pages, and counts a block a reorg then drops. They check the status of the subscribe answer, the snapshot and the lazy notice (also to a later client and to a peer that subscribes again after unsubscribing), the logged warnings with both counts, the delay notice after a reorg and the upstream request counts.

## Tests

- `says syncing for an account it still has to backfill, and ready once the account is complete`: REQ-SDS-9-ZRPZZW.T1.P9
- `tells a subscriber that a snapshot it was promised as ready is delayed when a reorg clears the cache`: REQ-SDS-12-N40MKR.T1.P9
- `keeps an account lazy and warns with both counts when the chain holds more entries than the history named`: REQ-SDS-9-ZRPZZW.T1.P10, REQ-SDS-9-ZRPZZW.T1.P11
- `tells a subscriber of a lazy account that no snapshot is coming also when it subscribes after the backfill`: REQ-SDS-9-ZRPZZW.T1.P12
- `tells the subscriber at once when the backfill fails`: REQ-SDS-9-ZRPZZW.T1.P13
- `tells a later subscriber that an account whose backfill failed is lazy, and does not backfill it again`: REQ-SDS-9-ZRPZZW.T1.P29, REQ-SDS-9-ZRPZZW.T1.P14
- `pushes the snapshot again to a peer that subscribes again after it unsubscribed`: REQ-SDS-9-ZRPZZW.T1.P30
- `pushes the snapshot and answers every slot from the cache when the chain holds just the entries the history named`: REQ-SDS-9-ZRPZZW.T1.P15
- `keeps an account lazy and tells its subscriber when a block's trace omits a write the chain holds`: REQ-SDS-9-ZRPZZW.T1.P16
- `keeps an account complete when the count after a write matches, at the cost of one hash read and one key page`: REQ-SDS-9-ZRPZZW.T1.P17
- `pushes an account without code with its balance and nonce where the Substrate node holds no contract for it`: REQ-SDS-9-ZRPZZW.T1.P28
- `pushes the slots written in blocks a lagging Substrate node had not reached yet`: REQ-SDS-9-ZRPZZW.T1.P27
- `keeps an account complete, and warns, when the count after a write fails`: REQ-SDS-9-ZRPZZW.T1.P32
- `keeps an account complete when a count that differs is of a block a reorg dropped`: REQ-SDS-9-ZRPZZW.T1.P33
- `counts a complete account once more, at the newest written block, for the blocks written while a count runs`: REQ-SDS-9-ZRPZZW.T1.P23
- `starts the backfill over when the block its values were read at is orphaned before they are committed, and names the key the replacement block wrote`: REQ-SDS-9-ZRPZZW.T1.P37
