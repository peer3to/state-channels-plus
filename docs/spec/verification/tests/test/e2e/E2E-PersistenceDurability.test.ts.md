# E2E-PersistenceDurability.test.ts

Test file: [test/e2e/E2E-PersistenceDurability.test.ts](../../../../../../../test/e2e/E2E-PersistenceDurability.test.ts)

## Overview

Every peer persists in its own partition. The next writer's database is made to fail every batch a flush waits for (`stub.failPersistenceFlushes`), timer batches still succeed, so the flush after it signs its block fails after its retries and the runtime aborts through the failure handler. The first case checks that no other peer holds a block at that height and none blacklisted the author. The second restarts the aborted author, waits for its restart synchronization to settle, lets it re-author that height from its disk, and checks that every peer agrees on the block there and no peer blacklisted it; re-authoring is safe because the unconfirmed block never left the process. The third gives a spectator a disk that fails every flush and checks it follows two blocks without aborting: it signs nothing, so it flushes nothing.

## Tests

- `a failed flush keeps the signed block from every peer, aborts the runtime and blacklists no peer`: REQ-STOR-8-25D06N.T1.P10
- `a spectator signs nothing, so a disk that fails every flush never stops it from following the channel`: none
- `a node restarted after a failed flush of its signed block authors that height again and the channel advances`: REQ-STOR-8-25D06N.T1.P11
