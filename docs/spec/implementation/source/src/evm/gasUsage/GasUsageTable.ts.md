# GasUsageTable.ts

> **Source:** [src/evm/gasUsage/GasUsageTable.ts](../../../../../../../src/evm/gasUsage/GasUsageTable.ts)
>
> **Design views:** [architecture/sdk/architecture.md](../../../../views/architecture/sdk/architecture.md)

## Requirements

- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)

## UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB

Aggregate recorded receipts into deterministic rows.

- Setup: A fresh `GasUsageTable`; `record` called with hand-chosen entries; `snapshot()` read.
- Oracle: Hand-computed counts, totals, and bounds, with no reverted gas inside a success field or a bound; the snapshot must stay JSON-safe and must not depend on the host locale.

- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P1` — empty table
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P2` — one entry
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P3` — repeated entries for one key
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P4` — reverted entry beside successful ones, bounds untouched
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P5` — one selector on two contracts
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P6` — row ordering
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P7` — total beyond the safe integer range
- [x] `UNIT-TEST-GAS-USAGE-TABLE-1-JX3HRB.P8` — a key with reverted entries only
