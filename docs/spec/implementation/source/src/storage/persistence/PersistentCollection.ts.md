# PersistentCollection.ts

> **Source:** [src/storage/persistence/PersistentCollection.ts](../../../../../../../src/storage/persistence/PersistentCollection.ts)

A `Map` whose writes the controller copies to disk. It keeps each key's insertion sequence so a load restores the map order, and runs the owning store's index rebuild after a load only.

## Requirements

- [`REQ-STOR-7-K1J7EA` (Write-behind disk copy loaded once)](../../../../../specification/storage/durability.md#req-stor-7-k1j7ea)
- [`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../../../../../specification/storage/durability.md#req-stor-6-skp0km)
