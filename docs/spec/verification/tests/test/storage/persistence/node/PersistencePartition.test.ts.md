# PersistencePartition.test.ts

Test file: [test/storage/persistence/node/PersistencePartition.test.ts](../../../../../../../../../test/storage/persistence/node/PersistencePartition.test.ts)
Exercises: [PersistencePartition.ts](../../../../../../../implementation/source/src/storage/persistence/PersistencePartition.ts.md)

## Overview

The suite opens real `classic-level` partitions in a temporary directory through `openPersistencePartition`, and edits a closed partition's metadata directly with `classic-level` to stage bad disk state. It checks that a caller-supplied location keeps its mode (only the default root the SDK creates is set to 0700), that a new partition's records are written in one synced batch (the real `classic-level` batch runs; the test only records its options), that differently spelled addresses and chain ids give one namespace and resume one partition, the metadata a new partition records, resume with the stored secret, the lock on a held partition, channel isolation, refused encoding versions in both directions, a missing secret record, an identity mismatch, the release of a partition after a refused bind, the explicit reset, and a `Storage` round trip on classic-level. The held-partition case opens twice from one process, not from a second process, so `REQ-STOR-11-Q4AT07.T1.P5` stays unassigned; the missing-record case removes only the secret, so `REQ-STOR-5-T6EQSA.T1.P11` stays unassigned.

## Tests

- `records a new partition's identity, encoding version and signer secret together`: REQ-STOR-11-Q4AT07.T1.P1
- `writes a new partition's records in one synced batch`: REQ-STOR-8-25D06N.T1.P22
- `maps checksummed and lowercase addresses, and decimal and hex chain ids, to one partition`: REQ-STOR-11-Q4AT07.T1.P10
- `leaves the mode of a location the caller supplied as it was`: none
- `resumes an existing partition with its stored signer secret`: none
- `refuses a second open of a held partition`: none
- `keeps one channel's records apart from another channel's`: REQ-STOR-5-T6EQSA.T1.P1
- `refuses a newer encoding version, naming both versions`: REQ-STOR-5-T6EQSA.T1.P4
- `refuses an older encoding version, naming both versions`: REQ-STOR-5-T6EQSA.T1.P6
- `refuses a partition missing its signer-secret record`: none
- `refuses a partition whose identity names another channel`: none
- `releases the partition when the bind is refused for bad disk state`: REQ-STOR-9-ZR8A92.T1.P4
- `starts a fresh partition with the new signer secret only on an explicit reset`: REQ-STOR-5-T6EQSA.T1.P13
- `restores blocks written through classic-level after a reopen`: none
