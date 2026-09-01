# ContractExecutorWorkerRuntime.ts — Source Report

> **Source:** [src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Node worker runtime bootstrap (limits, shutdown wiring): spawns the worker and returns its port and shutdown as a `WorkerLike`.

## Linked requirements

| Source file                                                                                                                | Specification IDs                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerRuntime.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
