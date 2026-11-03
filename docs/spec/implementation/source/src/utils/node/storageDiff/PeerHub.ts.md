# PeerHub.ts

> **Source:** [src/utils/node/storageDiff/PeerHub.ts](../../../../../../../../src/utils/node/storageDiff/PeerHub.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-3-5JW8AK` (Subscriptions belong to their connection and end on request)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-3-5jw8ak)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-SDS-11-QV2VPT` (Upstream trouble is retried, then fatal)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-11-qv2vpt)
- [`REQ-SDS-12-N40MKR` (A wait for a late block or snapshot ends at the first event, not at a fixed time)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-n40mkr)
- [`REQ-SDS-12-JDW71Y` (What peers can make the service hold is bounded)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-jdw71y)
