# RuntimeLifecycleRpcMethods.ts — Source Report

> **Source:** [RuntimeLifecycleRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/lifecycle/RuntimeLifecycleRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

`deployComplete` builds the runtime graph and its reply is the host's readiness; a failure before
it tears down what was built and rejects the same promise the client awaits. `quiesce` drains the
host's detached work and reports the rejections. `dispose` ends the runtime and closes the link
once its reply is out.

## Key design decisions

- **Readiness is a reply, not a message.** The client awaits `deployComplete`; there is no `ready`
  frame to correlate by hand ([`deployComplete`](../../../../../../../../../src/evm/p2pRuntime/rpc/lifecycle/RuntimeLifecycleRpcMethods.ts#L21)).
- **Close after the reply, on every path.** `dispose` schedules the link's close for after its own
  return, so the reply is never lost, and schedules it from a `finally` so a teardown that rejects
  still closes the link — the reply carries the failure, but a held-open port would strand the
  client waiting on a worker that never exits
  ([`dispose`](../../../../../../../../../src/evm/p2pRuntime/rpc/lifecycle/RuntimeLifecycleRpcMethods.ts#L56)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                              |
| ------------ | --------------------------------------------------------------------- |
| Inputs       | The two deployed addresses; nothing.                                  |
| Outputs      | Whether the WebRTC bridge is in use; the drained rejections; nothing. |
| Owned state  | None.                                                                 |
| Side effects | Builds and disposes the runtime; closes the transport.                |

## Linked requirements

| Source file                                                                                                                | Specification IDs                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RuntimeLifecycleRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/lifecycle/RuntimeLifecycleRpcMethods.ts) | [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- `deployComplete` runs once; a second call rebuilds nothing and is a caller error.

## Specification adherence

- Startup failure disposes partial state and surfaces as the readiness rejection ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).
- The drained rejections cross as serialized errors ({{REQ:[`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                            | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** `deployComplete` cleans up on failure; `dispose` closes after the reply on both the resolving and the rejecting path. **Other files:** [../../P2pRuntimeHost.ts.md](../../P2pRuntimeHost.ts.md) owns `buildRuntime` and `disposeRuntime`. | None.            |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** `quiesce` returns `SerializedError[]`. **Other files:** [../../../../rpc/serializeError.ts.md](../../../../rpc/serializeError.ts.md).                                                                                                     | None.            |

## Related source reports

- [RuntimeLifecycleService.ts.md](./RuntimeLifecycleService.ts.md)
