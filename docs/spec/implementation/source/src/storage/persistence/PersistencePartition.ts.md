# PersistencePartition.ts

> **Source:** [src/storage/persistence/PersistencePartition.ts](../../../../../../../src/storage/persistence/PersistencePartition.ts)

Opens one channel's partition, keyed by chain, manager, state machine and channel id. A new partition records its identity, encoding version and signer secret in one batch; an existing one resumes with its stored secret. Version and identity mismatches are refused; `reset` discards the partition only on request. The secret is stored unencrypted ([`FIND-STORAGE-9-0FTPD8`](../../../../../audit/open-findings.md#find-storage-9-0ftpd8)).

## Requirements

- [`REQ-STOR-11-Q4AT07` (Partition identity, ownership, and survival)](../../../../../specification/storage/durability.md#req-stor-11-q4at07)
- [`REQ-STOR-5-T6EQSA` (Isolation, integrity, and versioned encoding)](../../../../../specification/storage/durability.md#req-stor-5-t6eqsa)
