# BlockProductionService.ts

> **Source:** [src/stateManager/block/BlockProductionService.ts](../../../../../../../src/stateManager/block/BlockProductionService.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`INV-BLOCK-PIPE-1-1AB2ME` (Atomic ordered commit)](../../../../../specification/block-progression/block-processing.md#inv-block-pipe-1-1ab2me)
- [`REQ-BLOCK-PIPE-6-XQ0RTT` (Total-order application)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt)
- [`REQ-DISPUTE-PIPE-8-BVR8XV` (Dispute admission orders block signatures)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-8-bvr8xv)

## UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB

Local block authoring

- Setup: Submit through the real local signer across writer, channel, inbound, timestamp, linkage, and concurrency conditions.
- Oracle: Valid candidates commit one linked block; losing local races have no second effect; invalid candidates throw without committing.

- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P1` — scheduled writer predicate
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P2` — no pending inbound messages
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P3` — pending inbound messages consumed once
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P4` — incomplete inbound run omitted
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P5` — two same-author candidates for one coordinate commit one block
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P6` — current-height out-of-turn submission throws
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P7` — unopened channel throws
- [ ] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P8` — broken pending inbound chain throws
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P9` — prompt timestamp adjustment
- [ ] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P10` — preceding timestamp ahead of local clock
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P11` — late candidate timestamp clamp
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P12` — genesis and previous-block linkage
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P13` — another writer's block takes the candidate height first: dropped, no block by the submitter
- [x] `UNIT-TEST-BLOCK-PRODUCTION-1-5ED0EB.P14` — a reduction replaces the fork while the candidate waits for the mutex: dropped, no block on either fork
