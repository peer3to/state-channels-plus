# BlacklistStorage.ts

> **Source:** [src/storage/BlacklistStorage.ts](../../../../../../src/storage/BlacklistStorage.ts)
>
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Requirements

- [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
- [`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)

## UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF

Verdict record

- Setup: Record, re-record, read, remove, and clear verdicts by case-variant addresses
- Oracle: The first reason is kept; reads normalize; removal and clearing empty the record

- [x] `UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P1` — record and read back the address and reason
- [x] `UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P2` — a second verdict keeps the first reason and reports no new record
- [x] `UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P3` — remove clears one entry and reports whether it existed
- [x] `UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P4` — case-variant addresses read and remove the same entry
- [x] `UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P5` — clear empties every entry
