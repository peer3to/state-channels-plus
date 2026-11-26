# BlockCommitService.ts

> **Source:** [src/stateManager/block/BlockCommitService.ts](../../../../../../../src/stateManager/block/BlockCommitService.ts)

## Requirements

- [`REQ-TJOIN-3-DCZKS6` (Verified synchronization and membership)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-3-dczks6)
- [`REQ-TJOIN-5-Q795M7` (Phase-specific failure)](../../../../../specification/peer-communication/targeted-channel-join.md#req-tjoin-5-q795m7)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)
- [`REQ-LC-14-C00ZPH` (After each live commit the calldata commitments of the coming heights are…)](../../../../../specification/runtime/light-client.md#req-lc-14-c00zph)

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
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P7` — A successful dispute replay above the frozen view stores every replayed tail block without adding auditor signatures; active next height, status and force-join state stay unchanged
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P8` — A pending auditor replays a tail whose resulting participant set seats it; replayed head is stored without its confirmation, but local status, active height and force-join fields stay unchanged
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-1-V6TP9S.P9` — A pending auditor replays a tail that leaves its join unconsumed; latest full state becomes available while pending status, active height and force-join fields stay unchanged

## UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF

Watching the coming calldata commitments after a live commit

- Setup: A participant of a three-participant channel on the test chain commits blocks; the record of what was watched ahead is set to none, to the block's fork with 16 or 15 heights left, or to another fork before `watchCommitmentsAhead` runs on its latest stored block.
- Oracle: The record names the block's fork and the height 32 above the block exactly when the rule watches again, and is unchanged otherwise.

- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF.P1` — nothing watched ahead: the fork and the height 32 above the block are recorded
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF.P2` — 16 heights left: unchanged; 15 left: watched again
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF.P3` — the record names another fork: watched again at once
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF.P4` — one call per height and participant of the union reaches the chain access
- [ ] `UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF.P5` — a contract whose runner is not the SDK's chain access is told nothing
- [x] `UNIT-TEST-BLOCK-COMMIT-SERVICE-2-FN4FAF.P6` — a failing chain access is warned about and the commit stands
