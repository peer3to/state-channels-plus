# StorageDiffBackfill.test.ts

Test file: [test/utils/node/StorageDiffBackfill.test.ts](../../../../../../../test/utils/node/StorageDiffBackfill.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases subscribe to contracts whose history the service must backfill, against an isolated anvil test chain, and against a scripted Substrate child trie node where the child trie matters. They check the snapshot pushed, the status of the subscribe answer, the lazy notice, the logged warnings with both counts, the upstream request counts, and that a restarted service with a cache directory resumes without re-reading history.

## Tests

- `pushes the complete storage of a contract at the head when it is first subscribed, as anvil dumps it`: REQ-SDS-9-ZRPZZW.T1.P1
- `finds the deploy block by bisection and traces only the blocks with transactions since`: REQ-SDS-9-ZRPZZW.T1.P2
- `answers a read of a never-written slot of a complete contract without asking the upstream`: REQ-SDS-9-ZRPZZW.T1.P3
- `keeps a complete contract current from the records and does not push its snapshot again`: REQ-SDS-9-ZRPZZW.T1.P4
- `pushes an account without code with its balance and nonce`: REQ-SDS-9-ZRPZZW.T1.P5
- `includes a block mined while the history is being traced`: REQ-SDS-9-ZRPZZW.T1.P6
- `starts over when a reorg drops the block the history was read to`: REQ-SDS-9-ZRPZZW.T1.P7
- `reads on, in more rounds, the blocks mined past the retained window while the history was being traced`: REQ-SDS-9-ZRPZZW.T1.P8
- `resumes a complete contract from disk without reading its history again`: REQ-SDS-10-F01BMA.T1.P1
- `rolls the saved cache back when the saved head is no longer on the chain, then catches up`: REQ-SDS-10-F01BMA.T1.P2
- `applies the blocks mined while the service was down`: REQ-SDS-10-F01BMA.T1.P3
- `tells a subscriber that a snapshot it was promised as ready is delayed when a reorg clears the cache`: REQ-SDS-12-N40MKR.T1.P9
- `says syncing for an account it still has to backfill, and ready once the account is complete`: REQ-SDS-9-ZRPZZW.T1.P9
- `says lazy for an account whose backfill found fewer entries than the chain holds`: REQ-SDS-9-ZRPZZW.T1.P10
- `keeps an account lazy and warns with both counts when the chain holds more entries than the history named`: REQ-SDS-9-ZRPZZW.T1.P11
- `tells a subscriber of a lazy account that no snapshot is coming also when it subscribes after the backfill`: REQ-SDS-9-ZRPZZW.T1.P12
- `tells the subscriber at once when the backfill fails`: REQ-SDS-9-ZRPZZW.T1.P13
- `does not backfill a lazy account again when it is subscribed again`: REQ-SDS-9-ZRPZZW.T1.P14
- `pushes the snapshot and answers every slot from the cache when the chain holds just the entries the history named`: REQ-SDS-9-ZRPZZW.T1.P15
- `keeps an account lazy and tells its subscriber when a block's trace omits a write the chain holds`: REQ-SDS-9-ZRPZZW.T1.P16
- `keeps an account complete when the count after a write matches, at the cost of one hash read and one key page`: REQ-SDS-9-ZRPZZW.T1.P17
