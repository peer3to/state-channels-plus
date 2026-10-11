# WaitForSyncStatusGuard.ts

> **Source:** [src/rpc/network/guards/WaitForSyncStatusGuard.ts](../../../../../../../../src/rpc/network/guards/WaitForSyncStatusGuard.ts)

## Requirements

- [`REQ-GOSSIP-5-2EQ7P6` (Live gossip waits for the initial sync)](../../../../../../specification/peer-communication/block-gossip.md#req-gossip-5-2eq7p6)
- [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk)

## UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK

Live block RPCs wait for the initial sync and then run through the whole guard chain and normal validation.

- Setup: A fresh observer on a two-participant channel; its initial sync is held after the payload is fixed (state install held) or at the responders' answer (released as a failure). Live `onBlockConfirmation` RPCs arrive over the real transport: the next valid block by participant gossip, a stale copy and a wrong-fork block sent by a participant. A record-only probe counts each RPC run, the queue intake each run reaches, and the guard's retained count.
- Oracle: While the status is not engaged, no RPC reaches intake, nothing is queued and no second spectate request is sent; the held sync still completes. On `SYNCED` each retained RPC runs once more and reaches intake; the next block is applied from that run with no later copy needed. Stale and wrong-fork copies are judged by normal validation: the head and the adopted fork do not change and no wrong-fork block is stored. A failed initial sync aborts: the retained count is zero and no retained RPC ran again or reached intake.

- [x] `UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK.P1` — the next live block during a held initial sync is retained with no intake and no second sync; after `SYNCED` the first intake of that block is the guard's re-run, and the observer reaches it without a resend
- [x] `UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK.P2` — a retained stale copy and a retained wrong-fork block reach intake only after `SYNCED` and are not applied
- [x] `UNIT-TEST-WAIT-FOR-SYNC-GUARD-1-5ST9WK.P3` — an abort after a failed initial sync drops the retained RPCs without running them
