# EventSyncService.ts

> **Source:** [src/stateManager/eventSync/EventSyncService.ts](../../../../../../../src/stateManager/eventSync/EventSyncService.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../../views/architecture/sdk/block-confirmation-pipeline.md), [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-STOR-3-4RJGER` (Restart recovery without trust)](../../../../../specification/storage/durability.md#req-stor-3-4rjger)
- [`REQ-DISPUTE-PIPE-9-TDWQPV` (Existing-window state contributions)](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv)
- [`REQ-GOSSIP-4-J5Z4DF` (Eligible transport contribution)](../../../../../specification/peer-communication/block-gossip.md#req-gossip-4-j5z4df)
- [`REQ-IX-7-A004VZ` (Chain observation)](../../../../../specification/interactions.md#req-ix-7-a004vz)
- [`REQ-MIRROR-3-THD7K8` (Cache, never authority)](../../../../../specification/enforcement/local-mirror.md#req-mirror-3-thd7k8)
- [`REQ-RMSTORE-1-BWKVBG` (Monotone observation progress)](../../../../../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg)

## UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4

Ordering and recovery

- Setup: Deliver logs out of order; drop events; restart mid-stream; exhaust recovery attempts
- Oracle: Per-channel order preserved; recovery fills gaps within caps; restart resumes without skips

- [ ] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P1` — ordering
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P2` — gap recovery within attempts
- [ ] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P3` — restart resume
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P4` — recovery exhaustion behavior
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P5` — direct recovery returns no change for an empty set
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P6` — direct recovery exposes read failure
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P7` — recovery preserves kill timestamp and deduplicates repeated query
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P8` — authoritative slash recovery rejects a missing chain head
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P9` — authoritative slash recovery rejects exhausted chain log queries
- [x] `UNIT-TEST-EVENT-SYNC-SERVICE-1-0FB8Y4.P10` — a missed JOIN is recovered through EventHandler and appears in both fast eligibility and LocalDiamond before network-copy validation
