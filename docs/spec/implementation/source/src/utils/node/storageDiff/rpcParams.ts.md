# rpcParams.ts

> **Source:** [src/utils/node/storageDiff/rpcParams.ts](../../../../../../../../src/utils/node/storageDiff/rpcParams.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-2-R1RRCF` (Catch-up returns the retained history and the head)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-2-r1rrcf)
- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-8-FQFNTV` (Retained blocks, transactions and receipts are served from the service)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-8-fqfntv)
- [`REQ-SDS-12-N40MKR` (A wait for a late block or snapshot ends at the first event, not at a fixed time)](../../../../../../specification/runtime/storage-diff-service.md#req-sds-12-n40mkr)
