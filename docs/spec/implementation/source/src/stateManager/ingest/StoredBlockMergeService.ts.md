# StoredBlockMergeService.ts

> **Source:** [StoredBlockMergeService.ts](../../../../../../../src/stateManager/ingest/StoredBlockMergeService.ts#L1)
>
> **Design views:** [components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-BLOCK-PIPE-2-PCXNT6` (Complete pre-execution validation)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-2-pcxnt6)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../../specification/storage/queue.md#req-qstore-2-vywjaq)

## UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6

Stored confirmation strategy outcomes

- Setup: Drive the real merge service under live, spectating, calldata and dispute strategies with actual signed blocks; inspect persisted signatures and result or tripwire error.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P1` — a block this peer never stored → undefined, nothing persisted
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P2` — an identical stored confirmation → DUPLICATE, signature set untouched
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P3` — a genuine new participant signature → BROADCAST and the signature is persisted
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P4` — stray signature only → stripped, post-strip re-check lands DUPLICATE
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P5` — stray + a real new signature → stray stripped, the real one merges, BROADCAST
- [ ] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P6` — under SpectatingValidationStrategy a genuine new signature → BROADCAST and persisted
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P7` — under CalldataCommittedStrategy the event-shaped confirmation (no signatures) → DUPLICATE, the tripwire never fires
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P8` — under CalldataCommittedStrategy a genuine new signature → the unreachable tripwire throws
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P9` — under DisputeValidationStrategy a genuine new signature → DUPLICATE, not re-gossiped
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P10` — a real synced spectator persists late signatures without an outgoing confirmation
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P11` — a pending joiner persists late signatures without relaying before participant promotion
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P13` — unrecoverable confirmations are removed while the stored block remains committed
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P14` — a committed participant using SpectatingValidationStrategy broadcasts genuine signature growth
- [x] `UNIT-TEST-STORED-BLOCK-MERGE-SERVICE-32-NJ5TZ6.P15` — each stored copy retains at most N source values before ordinary validation; independent copies merge admitted confirmations
