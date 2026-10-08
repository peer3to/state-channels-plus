# EventSyncService.ts

> **Source:** [src/stateManager/eventSync/EventSyncService.ts](../../../../../../../src/stateManager/eventSync/EventSyncService.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md), [runtime/chain-observation.md](../../../../views/runtime/chain-observation.md)

## Requirements

- [`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../../../../../specification/storage/durability.md#req-stor-3-4rjger)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-CHAINOBS-3-N137ZP` (Per-endpoint observation with reconnect and catch-up)](../../../../../specification/runtime/chain-observation.md#req-chainobs-3-n137zp)
  Partial: a trusted endpoint can hold the completed-block watermark without end by failing every catch-up `eth_getLogs` or head request while its reopened socket stays open; accepted limit ([`FIND-RPC-1-E5ZHAR`](../../../../../audit/open-findings.md#find-rpc-1-e5zhar)).
- [`INV-CHAINOBS-1-ASVKC1` (Exactly-once event processing across endpoints)](../../../../../specification/runtime/chain-observation.md#inv-chainobs-1-asvkc1)
  Partial: every listed endpoint is trusted; logs are not cross-checked, so a forged log is processed and moves the watermark past real events; accepted limit ([`FIND-RPC-1-E5ZHAR`](../../../../../audit/open-findings.md#find-rpc-1-e5zhar)).
- [`REQ-IX-7-A004VZ` (Chain observation)](../../../../../specification/interactions.md#req-ix-7-a004vz)
- [`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)
- [`REQ-RMSTORE-1-BWKVBG` (Monotone observation progress)](../../../../../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg)

## UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4

Exactly-once scheduling of streamed logs

- Setup: A live session after a real top-up; the channel's real logs delivered again, with a changed block hash, as removed, or below the watermark; the handler records instead of applying.
- Oracle: Handler calls: none for a duplicate, removed or below-watermark log; one for a re-mined log.

- [x] `UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P1` — duplicate from a second stream
- [x] `UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P2` — re-mined in another block
- [x] `UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P3` — removed by a reorg
- [x] `UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P4` — lagging node's log below the watermark; <a id=\"unit-test-event-stream-dedup-1-hhp9f4.p5\"></a>
- [x] `UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P5` — never-seen log in the watermark block

## UNIT-TEST-EVENT-CATCH-UP-1-JV263P

Reconnect catch-up

- Setup: catchUpLogs on the peer's first real node after a lost subscription delivery, after full processing, and right after the channel opened; through a proxy whose head read fails once; holdWatermark taken twice around a real later top-up, and once on a channel before any block completed.
- Oracle: The lost log is dispatched once and restores the inbound head; processed and opening logs are not dispatched again; a failed head read answers the watermark with no eth_getLogs; the watermark passes a held block only after every hold on it is released.

- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P1` — lost log delivered
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P2` — processed log not dispatched again
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P3` — opening logs not dispatched again
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P4` — node head behind the watermark: nothing read
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P5` — node head at the watermark: exactly that block read
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P6` — failed head read: the watermark is answered for the retry and nothing is read, the retry from it reads from the watermark
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P7` — a held watermark stays while a later block completes and moves to that block on release
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P8` — a repeated release leaves another hold in place
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P9` — a hold taken before any watermark exists holds at the given start block, keeps the channel's first completed block unpublished, and publishes it on release
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P10` — reader head below the target head: nothing read, the watermark answered for the retry
- [x] `UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P11` — reader head at the target head: read up to it and caught up

## UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4

Ordering and recovery

- Setup: Deliver logs out of order; drop events; restart mid-stream; exhaust recovery attempts
- Oracle: Per-channel order preserved; recovery fills gaps within caps; restart resumes without skips

- [ ] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P1` — ordering
- [ ] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P2` — gap recovery within attempts
- [ ] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P3` — restart resume
- [ ] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P4` — recovery exhaustion behavior
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P5` — direct recovery returns no change for an empty set
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P6` — direct recovery exposes read failure
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P7` — recovery preserves kill timestamp and deduplicates repeated query
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P8` — authoritative slash recovery rejects a missing chain head
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P9` — authoritative slash recovery rejects exhausted chain log queries
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P10` — a missed JOIN is recovered through EventHandler and appears in both fast eligibility and LocalDiamond before network-copy validation
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P11` — a dispute recovery across several `LOG_QUERY_MAX_BLOCKS` windows whose second window fails once recovers on the next attempt and dispatches each dispute once

## UNIT-TEST-LOG-PAGES-1-39HC9S

Paged log reads

- Setup: readLogPages over a private node with more blocks than three windows, behind a proxy rejecting wider reads
- Oracle: Windows ascend, cover the range and never exceed the span; each window is handed over before the next read; a failed window is answered and a retry starts there

- [x] `UNIT-TEST-LOG-PAGES-1-39HC9S.P1` — ascending windows, each handed over before the next read
- [x] `UNIT-TEST-LOG-PAGES-1-39HC9S.P2` — failed window answered; an immediate retry reaches the node again and reads only from there
