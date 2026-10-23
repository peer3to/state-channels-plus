# P2pRuntimeHostRootEntry.ts

> **Source:** [worker/P2pRuntimeHostRootEntry.ts](../../../../../../../../src/rpc/internal/worker/P2pRuntimeHostRootEntry.ts)

## Requirements

- [`REQ-RPC-9-8FFE6S` (Application host root)](../../../../../../specification/peer-communication/rpc.md#req-rpc-9-8ffe6s)
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q

The SDK worker names its thread and starts the host root its payload names

- Setup: Run a full SDK setup with the SDK host in a worker started from this entry and collect logs at a real receiver; run it with a payload naming the probe host root and with one naming a non-class export.
- Oracle: The receiver stores the SDK worker's chunks under the `sdk` thread; the probe root serves its internal service; a non-class export fails worker startup and the client's setup rejects with the loader's error.

- [x] `UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q.P1` — the entry starts its worker as `sdk`, so that worker's uploads are filed under `sdk`
- [x] `UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q.P2` — the entry resolves the payload's host root manifest before it constructs the root
- [x] `UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q.P3` — a manifest naming no constructor fails worker startup and rejects the client's setup
