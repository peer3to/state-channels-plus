# ContractExecutorRootUrl.ts

> **Source:** [src/rpc/internal/browser/ContractExecutorRootUrl.ts](../../../../../../../../src/rpc/internal/browser/ContractExecutorRootUrl.ts)

## Requirements

- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)

## UNIT-TEST-BROWSER-EXECUTOR-URL-1-YNHKVA

Fixed built-in worker entry

- Setup: Real production roots and their public operations.
- Oracle: Fixed built-in worker entry; no duplicate completion or leaked ownership.

- [x] `UNIT-TEST-BROWSER-EXECUTOR-URL-1-YNHKVA.P1` — Normal setup resolves the built-in worker without caller URL configuration, awaits initialization and completes its domain operation
