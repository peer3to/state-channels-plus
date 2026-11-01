# StorageDiffBackfill.test.ts

Test file: [test/utils/node/StorageDiffBackfill.test.ts](../../../../../../../test/utils/node/StorageDiffBackfill.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases subscribe to contracts whose history the service must backfill, against an isolated anvil test chain. They check the snapshot pushed, the blocks traced, the upstream request counts and the records that keep a complete contract current.

## Tests

- `pushes the complete storage of a contract at the head when it is first subscribed, as anvil dumps it`: REQ-SDS-9-ZRPZZW.T1.P1
- `finds the deploy block by bisection and traces only the blocks with transactions since`: REQ-SDS-9-ZRPZZW.T1.P2
- `answers a read of a never-written slot of a complete contract without asking the upstream`: REQ-SDS-9-ZRPZZW.T1.P3
- `keeps a complete contract current from the records and does not push its snapshot again`: REQ-SDS-9-ZRPZZW.T1.P4
- `pushes an account without code with its balance and nonce`: REQ-SDS-9-ZRPZZW.T1.P5
- `includes a block mined while the history is being traced`: REQ-SDS-9-ZRPZZW.T1.P6
- `starts over when a reorg drops the block the history was read to`: REQ-SDS-9-ZRPZZW.T1.P7
- `reads on, in more rounds, the blocks mined past the retained window while the history was being traced`: REQ-SDS-9-ZRPZZW.T1.P8
