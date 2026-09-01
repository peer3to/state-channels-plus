# types.ts — Source Report

> **Source:** [src/evm/p2pRuntime/types.ts](../../../../../../../src/evm/p2pRuntime/types.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The one worker-level message: `WorkerBootstrapMessage`, which carries the setup payload, the
runtime port and the WebRTC bridge port into the worker by transfer — the only thing an RPC envelope
cannot carry. The port types are re-exported from the transport layer; no request or response
shapes live here any more.

## Key design decisions

1. `SerializedContract.abiJson` carries application ABI metadata across the port. For the manager,
   both runtime sides merge it after the SDK-owned ABI so consumer extensions remain available.

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

| Source file                                                  | Specification IDs                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [types.ts](../../../../../../../src/evm/p2pRuntime/types.ts) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) |

## Assumptions, dependencies, trust boundaries, and limits

- `abiJson` must be valid JSON ABI. Manager consumers apply the shared SDK-first merge policy.

## Specification adherence

- Port-protocol semantics identical across platforms.

## Conformance traceability

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [P2pRuntimeHost](./P2pRuntimeHost.ts.md).
