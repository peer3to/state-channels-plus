# BlockCommitService.ts

> **Source:** [src/stateManager/block/BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts)
>
> **Design views:** [dispute pipeline](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)

## UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S

Later cooperative inclusion

- Setup: Commit the first block that includes a receipt-confirmed pending joiner
- Oracle: Status advances to participating and force-join bookkeeping clears without changing the earlier connect result

- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P1` — pending joiner included by first committed block
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P2` — the full ingest pipeline stores a block without signing when dispute admission precedes commit
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P3` — a spectator commit persists state and calls success without signing or gossip
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P4` — a commit inserting the spectator promotes it and signs and gossips once
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P5` — dispute replay with a historical union preserves current off-chain eligibility
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P6` — a leaver with a parked exit post stays participating, ingests the blocks committed after its leave block, and broadcasts none of them
