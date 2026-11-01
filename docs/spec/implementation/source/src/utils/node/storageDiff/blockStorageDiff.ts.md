# blockStorageDiff.ts

> **Source:** [src/utils/node/storageDiff/blockStorageDiff.ts](../../../../../../../../src/utils/node/storageDiff/blockStorageDiff.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-3-5JW8AK` (Subscriptions belong to their connection and end on request)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-3-5jw8ak)
- [`REQ-SDS-4-ZZDEVF` (Reported values are the chain's own, not the tracer's)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-4-zzdevf)
- [`REQ-SDS-5-B2V01N` (Logs of subscribed addresses travel with their block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-5-b2v01n)

## UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS

`touchesOf` names the storage keys and scalars a block's traced transactions touched, `mergeTransactionDiffs` reads a slot the post of a trace omits as cleared, and `hasRevertedFrame` says whether the block's call frames hold an error at any depth.

- Setup: Call `touchesOf` with prestate-trace entries (pre and post maps, accounts left out of post) and `hasRevertedFrame` with call-frame traces (clean, failing on the top frame, nested two calls deep, failing in a later transaction, entries with errors of their own, missing, or of the wrong length), and both helpers with the traces recorded from Asset Hub for one block.
- Oracle: The returned key and scalar sets equal the touched ones with any transaction's flag kept; the failure flag is true exactly for a failed frame at any depth or an unusable trace.

- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P1` — the storage keys of pre and post are named and the scalars post shows are flagged
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P2` — every scalar of an account that post leaves out is flagged
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P3` — a flag set by any transaction of the block is kept
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P4` — clean frames, nested calls included, show no failure
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P5` — a failure on the top frame is found
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P6` — a failure on a nested frame two calls deep is found
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P7` — a failure in any transaction of the block is found
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P8` — an entry with an error of its own, a missing trace or a wrong length counts as failed
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P9` — the accounts and storage keys of a recorded Asset Hub prestate diff are named and the scalars its post shows are flagged
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P10` — a slot a recorded Asset Hub post omits is read as cleared to zero
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P11` — a recorded Asset Hub call tree with nested calls shows no failure
- [x] `UNIT-TEST-SDS-BLOCK-TOUCHES-1-0CE0ZS.P12` — an error injected into a nested frame of the recorded call tree is found
