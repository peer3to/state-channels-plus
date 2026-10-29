# EventSyncService.test.ts

Test file: [test/stateManager/EventSyncService.test.ts](../../../../../../test/stateManager/EventSyncService.test.ts)

## Overview

Two worker-realm probes drive the real `EventSyncService` of a live four-peer session through
harness-control stubs. `probeRejectedEventSyncLog` asserts the fatal-log policy: a log whose
handler rejects is never re-dispatched — the same promise is replayed to every waiter (handler
called once, the identical error surfaces on the first await, the second await, the detached
chain, and a later reschedule) and the per-channel cursor does not advance past the failure.
`probeConcurrentCalldataRecovery` asserts that concurrent calldata-recovery requests join one
in-flight chain query (two queries total across first/second/retry probes) and consistently
report the calldata as not found. Ordering across out-of-order log delivery, gap recovery within
attempt caps, and restart resume are not exercised here, so the service's planned permutations
stay unassigned.

Two `holdWatermark` cases hold the observer's watermark, let a real top-up complete a later block,
and check the watermark stays until every hold is released (a repeated release of one hold does not
release the other), then moves to the top-up's block. A third holds a channel that has no
watermark yet at the current chain head, opens the channel, checks the watermark is still unset
while held, and that the release publishes the opening block.

Four dispute-window cases run the real synchronized window load on an observer. Three stage a
final dispute whose streamed log reaches the observer while its handling is held until the
recovery's log query has answered, so the recovery finds that handling in flight. When the held
handling succeeds, the load resolves with the window and the dispute is stored. When the
handling stores the dispute and then fails its final-dispute preparation, the load still resolves
with the window. When the local diamond's write, the handling's first step, reverts, the load
rejects with that revert, a second load rejects the same way and the dispute stays missing. The
fourth loses the observer's streamed dispute logs and makes its dispute handler throw, so the
logs the recovery dispatches itself fail and the load rejects with that failure.

One inbound-run case loses a top-up's live inbound log and reverts the local diamond's next inbound
application once. The recovery rejects with the local EVM revert after its first query.

Two inbound-run cases lose live inbound logs and run the real synchronized load. One loses a
single top-up's log after the peer already holds the run below it; the load queries the chain and
the run becomes walkable. The other loses every inbound log from before the channel opens, so the
peer holds no inbound tip; the load recovers the logs and the store tip becomes the recovered head.

## Tests

- `drops subscription callbacks while stop is still draining scheduled work`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P3
- `starts no log dispatch after stop, so a recovery still running in a disposing runtime needs nothing its disposal closes`: UNIT-TEST-STATE-CHANNEL-EVENT-LISTENER-1-XHNMVW.P24
- `authoritative slash recovery returns no change for an empty chain set`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P34, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P5
- `authoritative slash recovery exposes a failed source read`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P35, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P6, REQ-CHAINOBS-3-N137ZP.T1.P33
- `authoritative slash recovery preserves the kill timestamp and deduplicates a repeated query`: REQ-DISPUTE-PIPE-9-TDWQPV.T1.P36, UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P7
- `authoritative slash recovery rejects a missing chain head`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P8
- `authoritative slash recovery rejects exhausted chain log queries`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P9
- `joins concurrent calldata recovery onto one chain query`: none
- `run already held → returned with no chain query`: none
- `missed inbound log → recovered by query, the run becomes walkable`: REQ-MSGSTORE-1-6ME9D7.T2.P2
- `logs recovered into an empty inbound store set its tip to the recovered head`: REQ-MSGSTORE-1-6ME9D7.T2.P1
- `only the inbound log we do not hold is dispatched`: none
- `the widening span stays inside the watermark and the chain`: none
- `gap survives recovery → undefined, no throw`: none
- `local diamond failure applying a recovered log → recovery rejects with it`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P20, REQ-CHAINOBS-3-N137ZP.T1.P23
- `missed calldata log → recovered by query, validation scheduled`: none
- `dispute recovery defeated → the window is reported unreadable, not thrown`: none
- `in-flight dispute log succeeds → recovery awaits it and resolves with its dispute stored`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P21
- `in-flight dispute log stores its dispute, then fails → recovery resolves with the window`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P22
- `in-flight dispute log fails before storing its dispute → recovery rejects with that failure, also on a second call`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P23
- `dispute log recovery dispatches itself fails → recovery rejects with that failure`: UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P24
- `the subscription filter is unchanged by the shared topic builder`: none
- `dispatches a log a second stream delivers again only once`: UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P1, INV-CHAINOBS-1-ASVKC1.T1.P1
- `dispatches a log re-mined in another block after a reorg as a new event`: UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P2, INV-CHAINOBS-1-ASVKC1.T1.P2
- `ignores a log a reorg removed`: UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P3, INV-CHAINOBS-1-ASVKC1.T1.P3
- `drops a lagging node's log below the watermark`: UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P4, INV-CHAINOBS-1-ASVKC1.T1.P6
- `schedules the log this peer's subscription lost`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P1, REQ-CHAINOBS-3-N137ZP.T1.P4
- `does not dispatch the channel's opening logs again`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P3, INV-CHAINOBS-1-ASVKC1.T1.P5
- `does not dispatch a log this peer already processed again`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P2, INV-CHAINOBS-1-ASVKC1.T1.P4
- `dispatches a never-seen log in the watermark block`: UNIT-TEST-EVENT-STREAM-DEDUP-1-HHP9F4.P5, INV-CHAINOBS-1-ASVKC1.T1.P8
- `keeps the watermark at its block while a later block completes, and publishes that block on release`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P7
- `a repeated release does not release another hold`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P8
- `holds at the given start block before any block completed, and publishes the channel's first block on release`: UNIT-TEST-EVENT-CATCH-UP-1-JV263P.P9
