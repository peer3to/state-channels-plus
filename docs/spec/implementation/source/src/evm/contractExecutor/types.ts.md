# types.ts — Source Report

> **Source:** [src/evm/contractExecutor/types.ts](../../../../../../../src/evm/contractExecutor/types.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Executor operation types and `WorkerLike`, the port-plus-shutdown a platform runtime hands the executor.

## Linked requirements

| Source file                                                        | Specification IDs |
| ------------------------------------------------------------------ | ----------------- |
| [types.ts](../../../../../../../src/evm/contractExecutor/types.ts) |                   |

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

- [AContractExecutor](./AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../views/architecture/sdk/runtime-and-concurrency.md).
