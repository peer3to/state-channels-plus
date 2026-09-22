# SnapshotUpdateService.ts

> **Source:** [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts)
>
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-DIS-9-64WHCD` (The on-chain snapshot advances to a successor fork only along committed…)](../../../../../specification/disputes/disputes.md#req-dis-9-64whcd)
- [`REQ-ENFSNAP-3-VD9T8A` (Inbound-consumption gate)](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a)
- [`REQ-IX-6-A4Y7KB` (Snapshot adoption and outbound processing)](../../../../../specification/interactions.md#req-ix-6-a4y7kb)
- [`REQ-MSG-5-5XB7DB` (Catch-up MUST be batchable into smaller ranges with identical results)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-5-5xb7db)
- [`REQ-MSG-7-Q40Q3R` (Same-fork advance MUST consume all pending inbound messages)](../../../../../specification/settlement/cross-layer-messages.md#req-msg-7-q40q3r)
- [`REQ-LIF-10-QR8NQ9` (Terminal runtime departure)](../../../../../specification/settlement/lifecycle.md#req-lif-10-qr8nq9)

## UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N

Walk, gates, and submission

- Setup: Advance across zero/one/multiple generations, unresolved disputes, and consumed/unconsumed inbound heads
- Oracle: Correct link chains and ranges; inadmissible preparation produces no transaction; admissible submission lands

- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P1` — multi-generation walk
- [ ] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P2` — range boundary at processed tip
- [ ] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P3` — same-fork chain
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P4` — already-current no-op
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P5` — admissible prepared snapshot is submitted
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P6` — unresolved current dispute blocks fork calldata and submission
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P7` — unconsumed inbound head blocks same-fork calldata preparation
- [x] `UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1-A4B38N.P8` — high-level posting stands down without changing the on-chain snapshot while inbound remains unconsumed
