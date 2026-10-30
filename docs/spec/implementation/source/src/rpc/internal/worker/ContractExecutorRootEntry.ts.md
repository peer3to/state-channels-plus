# ContractExecutorRootEntry.ts

> **Source:** [worker/ContractExecutorRootEntry.ts](../../../../../../../../src/rpc/internal/worker/ContractExecutorRootEntry.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-EXECUTOR-ROOT-ENTRY-1-2KNR1T

The executor worker names its thread

- Setup: Run a full SDK setup with a dedicated executor worker started from this entry, raise a real executor error and collect logs at a real receiver.
- Oracle: The receiver stores the executor worker's chunks under the `vm` thread.

- [x] `UNIT-TEST-EXECUTOR-ROOT-ENTRY-1-2KNR1T.P1` — the entry starts its worker as `vm`, so that worker's uploads are filed under `vm`
