# RuntimeChainContext.ts

> **Source:** [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)

## UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8

Provider cleanup

- Setup: Real runtime construction and public cleanup.
- Oracle: The provider closes, has no listeners and permits repeated destruction.

- [x] `UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P3` — Cleanup without subscriptions
- [x] `UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P4` — Cleanup with a block subscription
