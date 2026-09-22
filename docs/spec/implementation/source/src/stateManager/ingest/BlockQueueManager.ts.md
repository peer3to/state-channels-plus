# BlockQueueManager.ts

> **Source:** [src/stateManager/ingest/BlockQueueManager.ts](../../../../../../../src/stateManager/ingest/BlockQueueManager.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-BLOCK-PIPE-1-SS24D1` (Unified work item)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-1-ss24d1)
- [`REQ-BLOCK-PIPE-4-CF52J6` (Recovery without bypass)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-4-cf52j6)
- [`REQ-BLOCK-PIPE-5-WJ31RG` (Pre-execution merge layer)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-5-wj31rg)
- [`REQ-BLOCK-PIPE-6-XQ0RTT` (Total-order application)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-6-xq0rtt)
- [`REQ-BLOCK-PIPE-9-QA66GT` (Dead-fork containment)](../../../../../specification/block-progression/block-processing.md#req-block-pipe-9-qa66gt)
- [`REQ-LIF-7-0XZBDM` (A committed dispute suspends off-chain execution on the disputed)](../../../../../specification/settlement/lifecycle.md#req-lif-7-0xzbdm)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)
- [`REQ-QSTORE-2-VYWJAQ` (Independent source allowances)](../../../../../specification/storage/queue.md#req-qstore-2-vywjaq)
- [`REQ-QSTORE-3-DEKYG6` (Queue scheduling)](../../../../../specification/storage/queue.md#req-qstore-3-dekyg6)

## UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2

Intake gates and lifetime

- Setup: Ingest across channel/fork/dup/dead-fork cases; expire entries in each state
- Oracle: Gates apply in order; lifetime fixed under duplicates/restores; a probed source is kept when its same-fork proof carries the block or a verified successor makes the old-fork absence inconclusive; admitted-source expiry probes remain separate from ordinary unknown-source sync

- [ ] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P1` — gate order
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P2` — lifetime never extends
- [ ] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P3` — expiry drop branch
- [ ] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P4` — stale-fork silent drop at expiry
- [ ] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P5` — own-fork recovery coalescing
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P6` — expiry merge branch
- [ ] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P7` — expiry schedule branch
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P8` — active-fork future block whose source proves a lineage carrying it: applied, source kept
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P9` — unknown-fork one-shot sync probe at expiry
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P10` — active-fork future block whose source proves a lineage holding a different block at that height: dropped, source excluded
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P11` — active-fork future block at a height its source never reached: probe fails, dropped, source excluded
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P12` — junk supplier with another sync in flight toward it at expiry: the probe waits, then excludes
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P13` — a queue timeout accepts a proved successor fork without excluding the supplier or author
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P14` — an oversized verified eligibility cache does not expand the N-source allowance
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P16` — an explicit validation strategy stays outside the queued storage clone boundary
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P17` — an explicit validation strategy stays outside the stored-copy storage clone boundary
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P21` — deployment cache separates a small maximum from default and reuses the small deployment
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P23` — eligible source bypasses refresh and sync before queue retention
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P24` — wrong channel is rejected before sender refresh or retention
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P25` — forged author is rejected before sender refresh or retention
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P28` — a failed unknown copy preserves the existing honest contribution
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P32` — clear a disputed gossip queue while an audit replay is held; replay persists the snapshot and reduction completes
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P33` — a failed membership read can retry on the next request
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P34` — sync with no sender transport ends intake without queueing the block
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P35` — an unknown source still absent after a failed refresh invokes ordinary sync and does not retain the copy
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P36` — sync succeeds but the sender is still absent: blacklisted with no queue entry
- [x] `UNIT-TEST-BLOCK-QUEUE-MANAGER-1-YWS2D2.P37` — stopping the manager clears a future queued block and cancels its timeout
