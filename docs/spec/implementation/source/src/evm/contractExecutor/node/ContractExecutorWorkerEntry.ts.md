# ContractExecutorWorkerEntry.ts — Source Report

> **Source:** [src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Node worker entry point: hands the node error funnel to the shared bootstrap, which puts the
router, the parent line, the report path and the flush round in place and asserts this really is a
worker thread when it adapts the scope. Everything observable about the worker lives in that one
shared function.

## Linked requirements

| Source file                                                                                                            | Specification IDs                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerEntry.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.
- An error outside a request is reported to the owner over the worker-errors endpoint and this
  thread keeps serving; it also asks every reachable thread to send its logs, waiting for none of
  them ([`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)).

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [worker/bootstrapContractExecutorWorker.ts.md](../worker/bootstrapContractExecutorWorker.ts.md) — what it hands the funnel to.
- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
