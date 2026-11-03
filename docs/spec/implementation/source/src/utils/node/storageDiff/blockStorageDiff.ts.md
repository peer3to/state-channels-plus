# blockStorageDiff.ts

> **Source:** [src/utils/node/storageDiff/blockStorageDiff.ts](../../../../../../../../src/utils/node/storageDiff/blockStorageDiff.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-3-5JW8AK` (Subscriptions belong to their connection and end on request)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-3-5jw8ak)
- [`REQ-SDS-4-ZZDEVF` (Reported values are the chain's own, not the tracer's)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-4-zzdevf)
- [`REQ-SDS-5-B2V01N` (Logs of subscribed addresses travel with their block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-5-b2v01n)
- [`REQ-SDS-8-FQFNTV` (Retained blocks, transactions and receipts are served from the service)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-8-fqfntv)
