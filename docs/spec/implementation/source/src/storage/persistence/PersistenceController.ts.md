# PersistenceController.ts

> **Source:** [src/storage/persistence/PersistenceController.ts](../../../../../../../src/storage/persistence/PersistenceController.ts)

Copies collection writes to disk behind memory as one `database.batch` per drain. Drains start from the timer, `flush()` or `close()`; a batch a flush waits for is written with `sync`. Retries a failed batch, then fails for good and runs the failure handler once. `open` loads every collection in one all-or-nothing pass and refuses unknown collections, undecodable records, and records on both disk and memory. `unbind` drains and lets the database go (deleted when it holds no record) so a later `open` binds another; a failed batch does not make `close` reject.

## Requirements

- [`REQ-STOR-7-K1J7EA` (Write-behind disk copy loaded once)](../../../../../specification/storage/durability.md#req-stor-7-k1j7ea)
- [`REQ-STOR-8-25D06N` (Durable before a slashable signature leaves)](../../../../../specification/storage/durability.md#req-stor-8-25d06n)
- [`REQ-STOR-9-ZR8A92` (Closed by the one disposal)](../../../../../specification/storage/durability.md#req-stor-9-zr8a92)
- [`REQ-STOR-5-T6EQSA` (Isolation, integrity, and versioned encoding)](../../../../../specification/storage/durability.md#req-stor-5-t6eqsa)
- [`REQ-STOR-11-Q4AT07` (Partition identity, ownership, and survival)](../../../../../specification/storage/durability.md#req-stor-11-q4at07)
