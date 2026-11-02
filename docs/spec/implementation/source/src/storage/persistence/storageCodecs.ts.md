# storageCodecs.ts

> **Source:** [src/storage/persistence/storageCodecs.ts](../../../../../../../src/storage/persistence/storageCodecs.ts)

One ABI codec per persisted collection; the codec object's keys are the collection ids.

## Requirements

- [`REQ-STOR-5-T6EQSA` (Isolation, integrity, and versioned encoding)](../../../../../specification/storage/durability.md#req-stor-5-t6eqsa)
- [`REQ-STOR-7-K1J7EA` (Write-behind disk copy loaded once)](../../../../../specification/storage/durability.md#req-stor-7-k1j7ea)
