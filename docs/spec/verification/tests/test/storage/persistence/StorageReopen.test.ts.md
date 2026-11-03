# StorageReopen.test.ts

Test file: [test/storage/persistence/StorageReopen.test.ts](../../../../../../../../test/storage/persistence/StorageReopen.test.ts)
Exercises: [Storage.ts](../../../../../../implementation/source/src/storage/Storage.ts.md)

## Overview

The suite writes through the production `Storage` (its stores behind the copy proxies), closes it, and opens a new `Storage` on the same `GatedMemoryLevel` records, then reads through the public store methods. One case per store checks the round trip (coordinates, on-chain timestamps, caller-supplied keys, the genesis index); together they cover `REQ-STOR-7-K1J7EA.T1.P2`, which no single declaration covers in full, so it stays unassigned. Further cases cover rebuilt derived indexes, in-place updates, the head fork when the replaced fork is longer, a sync joiner's store, state the timer wrote with no close, the first-insertion tip rule for blocks and message blocks, the queue's entries (round trip with sources and signatures, the coordinate index rebuilt on load, a dequeue reaching disk, a queue and dequeue in one window written as one delete), and the fail-closed refusals of the head-fork check, each of which leaves the refused records out of memory and the same `Storage` bindable to a fresh database. Message blocks keep the base tree's head rule: a message block first stored for history and then stored normally moves the head, so `REQ-STOR-7-K1J7EA.T1.P12` stays unassigned and its declaration pins the current behavior.

## Tests

- `restores blocks at their coordinates with their on-chain timestamps`: none
- `restores inbound and outbound message blocks with their heads`: none
- `restores state snapshots under caller-supplied keys and the genesis index`: none
- `restores the genesis index as memory held it after an earlier genesis is stored again`: none
- `restores state machine states under caller-supplied keys`: none
- `restores participant change points per fork`: none
- `restores disputes with their merged signatures and the disputed-fork markers`: none
- `restores fraud proofs`: none
- `restores dispute fraud proofs`: none
- `restores timeouts, the force-exit flag and the join record`: none
- `restores block calldata and the event-sync cursor`: none
- `rebuilds the derived indexes on load: hash index, tip height, proof owner, message head and next join id`: REQ-STOR-7-K1J7EA.T1.P3
- `keeps insertion order across a reopen: the first proof per participant stays first`: none
- `writes in-place updates to disk: block merge, signature insert, on-chain timestamp, change point and join update`: REQ-STOR-7-K1J7EA.T1.P13
- `restores the head fork when the replaced fork holds more blocks`: REQ-STOR-7-K1J7EA.T1.P14
- `reopens a store captured from a node that joined by synchronization`: REQ-STOR-7-K1J7EA.T1.P15
- `keeps state written by the timer when the runtime stops without closing`: REQ-STOR-7-K1J7EA.T1.P20
- `does not advance the block tip for a block only ever stored for history`: REQ-STOR-7-K1J7EA.T1.P5
- `advances the block tip for a block first stored normally`: REQ-STOR-7-K1J7EA.T1.P6
- `keeps the block tip advanced for a block stored normally and then for history`: REQ-STOR-7-K1J7EA.T1.P7
- `keeps the block tip back for a block stored for history and then normally`: REQ-STOR-7-K1J7EA.T1.P8
- `does not move the message head for a message block only ever stored for history`: REQ-STOR-7-K1J7EA.T1.P9
- `moves the message head for a message block first stored normally`: REQ-STOR-7-K1J7EA.T1.P10
- `keeps the message head on a message block stored normally and then for history`: REQ-STOR-7-K1J7EA.T1.P11
- `moves the message head when a message block stored for history is stored normally`: none
- `restores a queued entry with its first-seen time, origin, sources and their signatures, and on-chain timestamp`: REQ-STOR-7-K1J7EA.T1.P23
- `rebuilds the coordinate index on load: a restored entry dequeues by its coordinates`: REQ-STOR-7-K1J7EA.T1.P24
- `keeps a dequeued entry off the disk after a reopen`: REQ-STOR-7-K1J7EA.T1.P25
- `writes an entry queued and dequeued in one window as one delete`: REQ-STOR-7-K1J7EA.T1.P26
- `refuses an undecodable record at the head, naming the partition and key`: REQ-STOR-5-T6EQSA.T1.P7
- `refuses an undecodable record in the middle of the history`: REQ-STOR-5-T6EQSA.T1.P8
- `refuses a gap in the head fork's stored blocks`: REQ-STOR-5-T6EQSA.T1.P9, REQ-STOR-7-K1J7EA.T1.P22
- `refuses a head-fork block that does not link to the block below it`: REQ-STOR-5-T6EQSA.T1.P10
- `refuses a head fork without the snapshot and state of its latest block`: none
