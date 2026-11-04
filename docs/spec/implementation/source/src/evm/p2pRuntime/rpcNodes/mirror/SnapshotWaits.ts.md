# SnapshotWaits.ts

> **Source:** [src/evm/p2pRuntime/rpcNodes/mirror/SnapshotWaits.ts](../../../../../../../../../src/evm/p2pRuntime/rpcNodes/mirror/SnapshotWaits.ts)

## Requirements

- [`REQ-RPCMIRROR-3-7MQH88` (A snapshot is waited for only when the service says it is ready)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-3-7mqh88)
- [`REQ-RPCMIRROR-8-1PA83T` (Trouble with the service degrades reads to the node, never fails them)](../../../../../../../specification/runtime/rpc-mirror.md#req-rpcmirror-8-1pa83t)

## UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY

`SnapshotWaits` holds a read's waits for snapshots only while the read runs, ends a wait at its backstop or at the read's time left, whichever comes first, and only once a snapshot being placed for it is placed.

- Setup: Expect a snapshot, then forget the read's waits, and expect the same account again for a later read; hold a snapshot's placement past a short backstop; give a read less time than its backstop.
- Oracle: A forgotten read's account is no longer awaited, a later read's wait survives the earlier read's forget, and the wait ends, with the backstop's error, only after the placement settles; a read with less time than its backstop ends when its time runs out.

- [x] `UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY.P1` — a read that ends early leaves no wait behind, and its forget leaves a later read's wait in place
- [x] `UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY.P2` — a wait past its backstop ends only once the snapshot being placed for it is placed
- [x] `UNIT-TEST-MIRROR-SNAPSHOT-WAITS-1-GADNHY.P3` — a read with less time left than its backstop ends its wait when that time runs out
