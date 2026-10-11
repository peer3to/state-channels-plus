# P2pRuntimeHostRootEntry.ts

> **Source:** [worker/P2pRuntimeHostRootEntry.ts](../../../../../../../../src/rpc/internal/worker/P2pRuntimeHostRootEntry.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q

The SDK worker names its thread

- Setup: Run a full SDK setup with the SDK host in a worker started from this entry and collect logs at a real receiver.
- Oracle: The receiver stores the SDK worker's chunks under the `sdk` thread.

- [x] `UNIT-TEST-HOST-ROOT-ENTRY-1-T7VY0Q.P1` — the entry starts its worker as `sdk`, so that worker's uploads are filed under `sdk`
