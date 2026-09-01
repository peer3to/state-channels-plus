# RuntimeEventsRpcMethods.ts — Source Report

> **Source:** [RuntimeEventsRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Two casts from the host: `busEvent(kind, eventName, args)`, one payload for every forwarded event
kind, and `hostError(error)`, an autonomous host-side failure not tied to a request.

## Key design decisions

- **Casts, by signature.** Both return `void`, so the host can only fire-and-forget them, which is
  what an event stream needs: back-pressure would stall the peer.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | A bus kind, event name and args; a serialized error.  |
| Outputs      | Nothing.                                              |
| Owned state  | None.                                                 |
| Side effects | The client's bus emits; the client's error path runs. |

## Linked requirements

| Source file                                                                                                              | Specification IDs                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RuntimeEventsRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsRpcMethods.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- Args are whatever structured clone carried; a non-cloneable arg failed on the host before it was sent.

## Specification adherence

- One payload shape for every event kind, both deployments ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- The host error crosses as a serialized error ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                      | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** `busEvent` re-emits into the client bus. **Other files:** [../../P2pRuntimeClient.ts.md](../../P2pRuntimeClient.ts.md).             | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `hostError` takes `SerializedError`. **Other files:** [../../../../rpc/serializeError.ts.md](../../../../rpc/serializeError.ts.md). | None.            |

## Related source reports

- [RuntimeEventsService.ts.md](./RuntimeEventsService.ts.md)
