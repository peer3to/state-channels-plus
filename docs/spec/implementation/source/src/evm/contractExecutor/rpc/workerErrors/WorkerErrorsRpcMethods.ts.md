# WorkerErrorsRpcMethods.ts — Source Report

> **Source:** [WorkerErrorsRpcMethods.ts](../../../../../../../../../src/evm/contractExecutor/rpc/workerErrors/WorkerErrorsRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

One endpoint: the error a vm worker caught outside a request, rebuilt through the shared codec and handed to the owner's sink. The worker keeps its canonical state and keeps serving; only the report crosses.

## Linked requirements

| Source file                                                                                                                          | Specification IDs                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [WorkerErrorsRpcMethods.ts](../../../../../../../../../src/evm/contractExecutor/rpc/workerErrors/WorkerErrorsRpcMethods.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Only the endpoint functions live here; the sink and the router reference sit on the service.
- The error crosses as a serialized shape and is rebuilt with the shared codec, so revert data and watchdog samples survive the hop.

## Specification adherence

- Report-and-continue: the endpoint neither ends the worker nor answers the caller ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                  | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** rebuilds the error and calls the sink. **Other files:** [WorkerErrorsService.ts.md](./WorkerErrorsService.ts.md) owns the sink; [../../../../rpc/serializeError.ts.md](../../../../rpc/serializeError.ts.md) is the codec. | None here.       |

## Related source reports

- [WorkerErrorsService.ts.md](./WorkerErrorsService.ts.md) — the service that owns the sink.
