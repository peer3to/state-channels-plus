# ContractExecutorWorkerEntry.ts — Source Report

> **Source:** [src/evm/contractExecutor/browser/ContractExecutorWorkerEntry.ts](../../../../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerEntry.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Browser worker entry point: the node-globals and `Buffer` shims the EVM stack needs, installed
before anything boots it, then the browser error funnel handed to the shared bootstrap, which puts
the router, the parent line, the report path and the flush round in place. The realm's logs now
leave after a detached vm error here too, which only the node entry used to do.

## Linked requirements

| Source file                                                                                                               | Specification IDs                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerEntry.ts](../../../../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerEntry.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) |

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

- [worker/bootstrapContractExecutorWorker.ts.md](../worker/bootstrapContractExecutorWorker.ts.md) — what it hands the funnel to.
- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
