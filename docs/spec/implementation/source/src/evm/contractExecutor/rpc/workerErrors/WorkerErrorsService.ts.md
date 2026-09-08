# WorkerErrorsService.ts — Source Report

> **Source:** [WorkerErrorsService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/workerErrors/WorkerErrorsService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The vm worker's one-way traffic to its owner as a service: errors the worker caught outside a request. Nothing here is answered, and the sink decides what the report means.

## Linked requirements

| Source file                                                                                                                | Specification IDs                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [WorkerErrorsService.ts](../../../../../../../../../src/evm/contractExecutor/rpc/workerErrors/WorkerErrorsService.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted worker port; no guards.
- The owner supplies the sink; the service never decides the policy itself.

## Specification adherence

- A detached worker error reaches the owning thread rather than dying in the worker ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                       | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** carries the report to the owner. **Other files:** [WorkerErrorsRpcMethods.ts.md](./WorkerErrorsRpcMethods.ts.md) is the endpoint; [../../WorkerContractExecutor.ts.md](../../WorkerContractExecutor.ts.md) decides report-and-continue. | None here.       |

## Related source reports

- [WorkerErrorsRpcMethods.ts.md](./WorkerErrorsRpcMethods.ts.md) — the endpoint.
- [../ContractExecutorClientRoot.ts.md](../ContractExecutorClientRoot.ts.md) — the root that composes it.
