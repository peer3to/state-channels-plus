# ContractExecutorWorkerEntry.ts — Source Report

> **Source:** [src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Node worker entry point: a `PortRpcRouter` serving `ContractExecutorRoot` over the parent port, plus the crash hooks that collect logs and end the thread.

## Linked requirements

| Source file                                                                                                            | Specification IDs                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ContractExecutorWorkerEntry.ts](../../../../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1) |

## Assumptions, dependencies, trust boundaries, and limits

- Cross-context values use the canonical transfer-safe encodings; ownership and ordering per the runtime rules.

## Specification adherence

- Executor semantics identical across contexts per the runtime equivalence rules.
- On an error this thread asks every reachable thread to send its logs, waits only for its own send,
  then ends with a non-zero exit ([`REQ-LOG-10-69CTN1`](../../../../../../specification/runtime/log-collection.md#req-log-10-69ctn1)).

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [AContractExecutor](../AContractExecutor.ts.md), [runtime-and-concurrency view](../../../../../views/architecture/sdk/runtime-and-concurrency.md).
