# E2E-PersistenceDurability.test.ts

Test file: [test/e2e/E2E-PersistenceDurability.test.ts](../../../../../../../test/e2e/E2E-PersistenceDurability.test.ts)

## Overview

The persistent peers keep their channel in their own partitions. The hold cases park every batch a flush waits for at a peer's database (`stub.holdPersistenceFlushes`, timer batches still pass), wait until a flush reached the gate, keep it there through a 500 ms absence window and check that the signature behind it reached nobody, then release it and check that it arrives. The block case holds the next writer and one other participant: no peer holds the authored block while the author's flush is held, and once it is released no peer holds the held participant's confirmation until that flush is released. The dispute case holds the disputer and records its upload without sending it; no upload is recorded until the release. The join case holds a synced spectator and one founder, both persistent: while the spectator's flush is held its signature request reaches no founder (the held founder records no flush), and while the founder's countersignature flush is held the spectator submits nothing and stays `SYNCED`; after both releases the join lands. The open-channel case holds both peers of a lobby match before any channel is bound, so the hold applies to the partition each binds during negotiation: while the lower address's flush is held the higher one signs nothing, and while the higher one's flush is held it has not issued its opening signature; after both releases the channel opens and both participate. In the failure cases the next writer's database fails every batch a flush waits for (`stub.failPersistenceFlushes`), so the flush after it signs its block fails after its retries and the runtime aborts through the failure handler. The first failure case checks that no other peer holds a block at that height and none blacklisted the author. The second restarts the aborted author, waits for its restart synchronization to settle, lets it re-author that height from its disk, and checks that every peer agrees on the block there and no peer blacklisted it; re-authoring is safe because the unconfirmed block never left the process. The third gives a spectator a disk that fails every flush and checks it follows two blocks without aborting: it signs nothing, so it flushes nothing.

## Tests

- `a failed flush keeps the signed block from every peer, aborts the runtime and blacklists no peer`: REQ-STOR-8-25D06N.T1.P10
- `an authored block reaches no peer until the author's disk confirms it, and a confirmation of it reaches no peer until the confirmer's disk confirms it`: REQ-STOR-8-25D06N.T1.P5, REQ-STOR-8-25D06N.T1.P6
- `a signed dispute is not sent to the chain until its write is confirmed`: REQ-STOR-8-25D06N.T1.P7
- `a join signature leaves neither the joiner nor a countersigning member until its write is confirmed, and the join then lands`: REQ-STOR-8-25D06N.T1.P8
- `an open-channel signature leaves neither the lower nor the higher address until its write is confirmed, and the channel then opens`: REQ-STOR-8-25D06N.T1.P9
- `a spectator signs nothing, so a disk that fails every flush never stops it from following the channel`: none
- `a node restarted after a failed flush of its signed block authors that height again and the channel advances`: REQ-STOR-8-25D06N.T1.P11
