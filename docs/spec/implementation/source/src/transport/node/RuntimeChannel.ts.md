# RuntimeChannel.ts — Source Report

> **Source:** [src/transport/node/RuntimeChannel.ts](../../../../../../../src/transport/node/RuntimeChannel.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Adapts node MessagePort operations to RuntimePort and constructs local or transferable channels. The adapter only converts host API calls; logical RPC routing, errors and ownership remain above it.

## Key design decisions

Only Node MessagePorts are accepted at runtime. The DOM union remains a typing boundary for transferred ports, but DOM event handling belongs to the browser adapter.

- Message listeners are registered before message dispatch starts ([`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L24)).
- Both listener registration methods return removers used by InternalTransport cleanup ([`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L40)).
- A transferable channel exposes its remote raw port exactly once for bootstrap transfer ([`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L71)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Inputs       | Host MessagePort or worker endpoint, message handlers and transfer lists.                              |
| Outputs      | RuntimePort adapters, local channel pairs, or an adapted local port plus raw transferable remote port. |
| Owned state  | Handler closures attached to the underlying host endpoint.                                             |
| Side effects | Host postMessage, listener installation/removal, start and close.                                      |

## Linked requirements

| Source file                                                                         | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y), [`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Host postMessage receives the logical value and explicit transfer list unchanged
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Listener removers and close are exposed to the owning internal transport
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Host-specific calls implement the same neutral RuntimePort surface
- [`REQ-RUNTIME-5-WJ1XKK` (Required host environments: browser and Node)](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk): The platform alias selects this implementation only for its matching build

## Assumptions, dependencies, trust boundaries, and limits

Node close events notify the adapter when either endpoint disconnects. This adapter rejects non-Node ports; browser ports use the [browser adapter](../browser/RuntimeChannel.ts.md). This file stays under the node directory and the opposite platform TypeScript build excludes it. Serialization failures propagate synchronously; the adapter does not convert domain errors or retry sends.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): Host postMessage receives the logical value and explicit transfer list unchanged See [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L18).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): Listener removers and close are exposed to the owning internal transport See [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L40).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): Host-specific calls implement the same neutral RuntimePort surface See [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L8).
- [`REQ-RUNTIME-5-WJ1XKK` (Required host environments: browser and Node)](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk): The platform alias selects this implementation only for its matching build See [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L1).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                          | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** Host postMessage receives the logical value and explicit transfer list unchanged [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L18). **Other files:** [RuntimePort.ts](../RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalTransport.ts](../InternalTransport.ts.md) (structured-clone delivery and port listener cleanup), [setupP2pRuntime.ts](../../evm/p2pRuntime/setupP2pRuntime.ts.md) (SDK placement, deployment and client/host construction), [createContractExecutor.ts](../../evm/contractExecutor/createContractExecutor.ts.md) (SDK-owned local/worker connection construction). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** Listener removers and close are exposed to the owning internal transport [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L40). **Other files:** [RuntimePort.ts](../RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalTransport.ts](../InternalTransport.ts.md) (structured-clone delivery and port listener cleanup), [setupP2pRuntime.ts](../../evm/p2pRuntime/setupP2pRuntime.ts.md) (SDK placement, deployment and client/host construction), [createContractExecutor.ts](../../evm/contractExecutor/createContractExecutor.ts.md) (SDK-owned local/worker connection construction).         | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** Host-specific calls implement the same neutral RuntimePort surface [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L8). **Other files:** [RuntimePort.ts](../RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalTransport.ts](../InternalTransport.ts.md) (structured-clone delivery and port listener cleanup), [setupP2pRuntime.ts](../../evm/p2pRuntime/setupP2pRuntime.ts.md) (SDK placement, deployment and client/host construction), [createContractExecutor.ts](../../evm/contractExecutor/createContractExecutor.ts.md) (SDK-owned local/worker connection construction).                | None demonstrated for this contribution. |
| [`REQ-RUNTIME-5-WJ1XKK`](../../../../../specification/runtime/execution.md#req-runtime-5-wj1xkk) | Covered               | **Here:** The platform alias selects this implementation only for its matching build [`RuntimeChannel.ts`](../../../../../../../src/transport/node/RuntimeChannel.ts#L1). **Other files:** [RuntimePort.ts](../RuntimePort.ts.md) (neutral raw-port and transfer contracts), [InternalTransport.ts](../InternalTransport.ts.md) (structured-clone delivery and port listener cleanup), [setupP2pRuntime.ts](../../evm/p2pRuntime/setupP2pRuntime.ts.md) (SDK placement, deployment and client/host construction), [createContractExecutor.ts](../../evm/contractExecutor/createContractExecutor.ts.md) (SDK-owned local/worker connection construction).        | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [RuntimePort.ts](../RuntimePort.ts.md)
- [InternalTransport.ts](../InternalTransport.ts.md)
- [setupP2pRuntime.ts](../../evm/p2pRuntime/setupP2pRuntime.ts.md)
- [createContractExecutor.ts](../../evm/contractExecutor/createContractExecutor.ts.md)
