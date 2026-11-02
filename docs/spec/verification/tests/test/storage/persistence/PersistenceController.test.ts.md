# PersistenceController.test.ts

Test file: [test/storage/persistence/PersistenceController.test.ts](../../../../../../../../test/storage/persistence/PersistenceController.test.ts)
Exercises: [PersistenceController.ts](../../../../../../implementation/source/src/storage/persistence/PersistenceController.ts.md)

## Overview

The suite drives a real `PersistenceController` with one `PersistentCollection` over `GatedMemoryLevel`, a real `memory-level` whose batches the test holds, releases or fails and whose batch options it records. Writes go through the collection and are observed on the database: the number and contents of batches, their `sync` option, and the records a reopen loads. It covers one batch per synchronous step past the pending-size warning, latest-value-wins within a window, flush timing (at once, after the disk confirms, idle, in flight), the synced flush batch, retry then permanent failure with the failure handler, close draining before the database closes, close after a failure closing the database without a second error, writes made after close started staying in memory while its batch is held, unbinding (a database with records kept, one without deleted, another bound with what memory holds), load order, the late bind of an empty disk, and the refusals of `open` (records on both sides, undecodable record, unknown collection, close during the load, second open). The flush-after-close case resolves with close's own promise, and the failure case observes the failure handler, not the runtime abort, so `REQ-STOR-7-K1J7EA.T1.P19` stays unassigned.

## Tests

- `writes one synchronous step of many writes, past the pending-size warning, as one batch with one operation per key`: REQ-STOR-7-K1J7EA.T1.P17
- `replaces an earlier write to a key in the same window, and a set then delete is one delete`: REQ-STOR-7-K1J7EA.T1.P18
- `writes pending state on flush without waiting for the timer, resolves only once the disk confirms, and resolves at once with nothing pending`: REQ-STOR-8-25D06N.T1.P1
- `resolves a flush at once when nothing is pending, with or without a disk`: none
- `resolves a flush issued while a batch is in flight only after the batch that covers its writes`: REQ-STOR-8-25D06N.T1.P3
- `syncs the batch a flush waits for and not a timer batch`: REQ-STOR-8-25D06N.T1.P4
- `retries a failed batch and writes it`: none
- `fails after its retries: waiting flushes reject, the failure handler runs once, later writes stay in memory and close still closes the database`: REQ-STOR-8-25D06N.T1.P2
- `closes by draining pending writes, waiting for the last batch, then closing the database`: REQ-STOR-9-ZR8A92.T1.P1
- `keeps a write made after close started off the disk while the close's batch is held`: REQ-STOR-9-ZR8A92.T1.P2
- `keeps a write after close in memory, raises no error and never writes it to disk`: REQ-STOR-8-25D06N.T1.P2, REQ-STOR-9-ZR8A92.T1.P2
- `loads records in their stored order and runs the load callback once`: REQ-STOR-7-K1J7EA.T1.P4
- `binds an empty disk late by keeping what memory holds and writing it`: none
- `refuses a load when memory and disk both hold records, closes the database and leaves memory as it was`: REQ-STOR-7-K1J7EA.T1.P16
- `refuses an undecodable record naming its collection, key and location, closes the database and leaves memory empty`: none
- `refuses a record of an unknown collection`: none
- `releases the database when close begins while the load is running`: REQ-STOR-9-ZR8A92.T1.P5
- `refuses a second open`: none
- `unbinds after draining pending writes, keeps a database that holds records and binds another one with what memory holds`: REQ-STOR-11-Q4AT07.T1.P8
- `closes an unbound database that holds no record and keeps its metadata`: REQ-STOR-11-Q4AT07.T1.P8
