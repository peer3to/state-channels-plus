# StorageDiffService.ts

> **Source:** [src/utils/node/storageDiff/StorageDiffService.ts](../../../../../../../../src/utils/node/storageDiff/StorageDiffService.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-2-R1RRCF` (Catch-up returns the retained history and the current levels)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-2-r1rrcf)
- [`REQ-SDS-3-5JW8AK` (Subscriptions belong to their connection and end on request)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-3-5jw8ak)
- [`REQ-SDS-4-ZZDEVF` (Reported values are the chain's own, not the tracer's)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-4-zzdevf)
- [`REQ-SDS-5-B2V01N` (Logs of subscribed addresses travel with their block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-5-b2v01n)
- [`REQ-SDS-6-SH7DKR` (The included head is a second, final level)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-6-sh7dkr)
- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-8-FQFNTV` (Retained blocks, transactions and receipts are served from the service)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-8-fqfntv)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-SDS-10-F01BMA` (The cache survives a restart when a cache directory is configured)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-10-f01bma)
- [`REQ-SDS-11-QV2VPT` (Upstream trouble is retried, then fatal)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-11-qv2vpt)
- [`REQ-SDS-12-N40MKR` (A wait for a late block or snapshot ends at the first event, not at a fixed time)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-n40mkr)
