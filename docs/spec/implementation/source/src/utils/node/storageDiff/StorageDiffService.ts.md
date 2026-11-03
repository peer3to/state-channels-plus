# StorageDiffService.ts

> **Source:** [src/utils/node/storageDiff/StorageDiffService.ts](../../../../../../../../src/utils/node/storageDiff/StorageDiffService.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-2-R1RRCF` (Catch-up returns the retained history and the head)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-2-r1rrcf)
- [`REQ-SDS-3-5JW8AK` (Subscriptions belong to their connection and end on request)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-3-5jw8ak)
- [`REQ-SDS-4-ZZDEVF` (Reported values are the chain's own, not the tracer's)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-4-zzdevf)
- [`REQ-SDS-5-B2V01N` (Logs of subscribed addresses travel with their block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-5-b2v01n)
- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-8-FQFNTV` (Retained blocks, transactions and receipts are served from the service)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-8-fqfntv)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-SDS-11-QV2VPT` (Upstream trouble is retried, then fatal)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-11-qv2vpt)
- [`REQ-SDS-12-N40MKR` (A wait for a late block or snapshot ends at the first event, not at a fixed time)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-n40mkr)
- [`REQ-SDS-12-JDW71Y` (What peers can make the service hold is bounded)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-jdw71y)

## UNIT-TEST-SDS-SERVICE-1-E7VQBH

`StorageDiffService.start` checks its options before it connects.

- Setup: Start the service with a limit of zero.
- Oracle: The start fails naming the bad option.

- [x] `UNIT-TEST-SDS-SERVICE-1-E7VQBH.P1` — a limit that is not a positive integer fails the start
