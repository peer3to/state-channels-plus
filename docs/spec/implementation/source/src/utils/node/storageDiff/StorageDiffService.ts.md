# StorageDiffService.ts

> **Source:** [src/utils/node/storageDiff/StorageDiffService.ts](../../../../../../../../src/utils/node/storageDiff/StorageDiffService.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-2-R1RRCF` (Catch-up returns the retained history and the head)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-2-r1rrcf)
- [`REQ-SDS-3-5JW8AK` (Subscriptions belong to their connection and end on request)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-3-5jw8ak)
- [`REQ-SDS-4-ZZDEVF` (Reported values are the chain's own, not the tracer's)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-4-zzdevf)
- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-11-QV2VPT` (Upstream trouble is retried, then fatal)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-11-qv2vpt)
