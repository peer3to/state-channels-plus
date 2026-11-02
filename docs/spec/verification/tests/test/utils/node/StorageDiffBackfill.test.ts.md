# StorageDiffBackfill.test.ts

Test file: [test/utils/node/StorageDiffBackfill.test.ts](../../../../../../../test/utils/node/StorageDiffBackfill.test.ts)
Exercises: [StorageDiffService.ts](../../../../../implementation/source/src/utils/node/storageDiff/StorageDiffService.ts.md)

## Overview

Cases subscribe to contracts whose history the service must backfill, against an isolated anvil test chain. They check the snapshot pushed, the blocks traced, the upstream request counts and the records that keep a complete contract current. The deploy block search cases answer the code probe with errors through the relay, the values cases answer a storage read with null, fail one trace, or count the reads the relay holds at once; their oracles are the deploy block the service reports, the snapshot and the warnings.

## Tests

- `pushes the complete storage of a contract at the head when it is first subscribed, as anvil dumps it`: REQ-SDS-9-ZRPZZW.T1.P1
- `finds the deploy block by bisection and traces only the blocks with transactions since`: REQ-SDS-9-ZRPZZW.T1.P2
- `answers a read of a never-written slot of a complete contract without asking the upstream`: REQ-SDS-9-ZRPZZW.T1.P3
- `keeps a complete contract current from the records and does not push its snapshot again`: REQ-SDS-9-ZRPZZW.T1.P4
- `pushes an account without code with its balance and nonce`: REQ-SDS-9-ZRPZZW.T1.P5
- `includes a block mined while the history is being traced`: REQ-SDS-9-ZRPZZW.T1.P6
- `starts over when a reorg drops the block the history was read to`: REQ-SDS-9-ZRPZZW.T1.P7
- `reads on, in more rounds, the blocks mined past the retained window while the history was being traced`: REQ-SDS-9-ZRPZZW.T1.P8
- `finds the deploy block when the upstream answers that reads below its contracts pallet are not supported`: REQ-SDS-9-ZRPZZW.T1.P19
- `starts the backfill over, and keeps the deploy block, when a code probe below the head is answered with another error`: REQ-SDS-9-ZRPZZW.T1.P20
- `does not take an error answer to the code probe at the head for an account without code`: REQ-SDS-9-ZRPZZW.T1.P21
- `keeps a backfill's value reads within 16 at the upstream at once and its traces within 8`: REQ-SDS-9-ZRPZZW.T1.P24
- `asks a failed trace again on its own, without starting the backfill over`: REQ-SDS-9-ZRPZZW.T1.P31
- `fails the backfill, and reads the account lazily, when a storage word it reads is malformed`: REQ-SDS-9-ZRPZZW.T1.P22
