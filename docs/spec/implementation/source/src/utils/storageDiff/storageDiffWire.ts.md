# storageDiffWire.ts

> **Source:** [src/utils/storageDiff/storageDiffWire.ts](../../../../../../../src/utils/storageDiff/storageDiffWire.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-2-R1RRCF` (Catch-up returns the retained history and the current levels)](../../../../../specification/runtime/storage-diff-service.md#req-sds-2-r1rrcf)
- [`REQ-SDS-6-SH7DKR` (The included head is a second, final level)](../../../../../specification/runtime/storage-diff-service.md#req-sds-6-sh7dkr)
- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
