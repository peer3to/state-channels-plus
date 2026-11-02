# storageDiffWire.ts

> **Source:** [src/utils/storageDiff/storageDiffWire.ts](../../../../../../../src/utils/storageDiff/storageDiffWire.ts)

## Requirements

- [`REQ-SDS-1-TXEY33` (A subscription receives one record per canonical block)](../../../../../specification/runtime/storage-diff-service.md#req-sds-1-txey33)
- [`REQ-SDS-2-R1RRCF` (Catch-up returns the retained history and the head)](../../../../../specification/runtime/storage-diff-service.md#req-sds-2-r1rrcf)
- [`REQ-SDS-5-B2V01N` (Logs of subscribed addresses travel with their block)](../../../../../specification/runtime/storage-diff-service.md#req-sds-5-b2v01n)
- [`REQ-SDS-7-PZCBQ9` (State reads come from one shared cache)](../../../../../specification/runtime/storage-diff-service.md#req-sds-7-pzcbq9)
- [`REQ-SDS-9-ZRPZZW` (A subscription is anchored by a complete snapshot, or told none is coming)](../../../../../specification/runtime/storage-diff-service.md#req-sds-9-zrpzzw)
- [`REQ-SDS-12-N40MKR` (A wait for a late block or snapshot ends at the first event, not at a fixed time)](../../../../../specification/runtime/storage-diff-service.md#req-sds-12-n40mkr)
- [`REQ-SDS-12-JDW71Y` (What peers can make the service hold is bounded)](../../../../../specification/runtime/storage-diff-service.md#req-sds-12-jdw71y)
