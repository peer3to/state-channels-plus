# RuntimePort.ts — Source Report

> **Source:** [src/transport/RuntimePort.ts](../../../../../../src/transport/RuntimePort.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Declares the raw platform port and linked-channel contracts shared by SDK, executor and WebRTC endpoints. There is no RPC protocol or endpoint state in these interfaces.

## Key design decisions

- The post surface accepts an explicit transfer list without selecting a domain codec ([`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L10)).
- Both message and close subscriptions expose removal functions ([`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L13)).
- Close notification is reliable on Node and best-effort in browsers ([`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L16)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| Inputs       | Unknown cloneable messages, transferables and handler functions used locally by the adapter. |
| Outputs      | Synchronous post and lifecycle methods; unsubscribe functions; linked port pairs.            |
| Owned state  | None; type-only interfaces.                                                                  |
| Side effects | None in this declaration file.                                                               |

## Linked requirements

| Source file                                                           | Specification IDs                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The port contract retains explicit ownership transfer
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The adapter contract exposes explicit close and listener removal
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): One interface describes both host implementations without importing host modules

## Assumptions, dependencies, trust boundaries, and limits

Handlers and adapter objects are local resources and are not serialized as RPC arguments. The raw transferable endpoint returned by the channel factory is distinct from its local RuntimePort adapter. InternalTransport owns delivery and close settlement.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The port contract retains explicit ownership transfer See [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L10).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The adapter contract exposes explicit close and listener removal See [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L13).
- [`REQ-RUNTIME-4-B0N70Y` (Platform equivalence)](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y): One interface describes both host implementations without importing host modules See [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L8).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Gap / divergence                         |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The port contract retains explicit ownership transfer [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L10). **Other files:** [RuntimeChannel.ts](node/RuntimeChannel.ts.md) (host port adaptation and listener removal), [RuntimeChannel.ts](browser/RuntimeChannel.ts.md) (host port adaptation and listener removal), [InternalTransport.ts](InternalTransport.ts.md) (structured-clone delivery and port listener cleanup).                           | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** The adapter contract exposes explicit close and listener removal [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L13). **Other files:** [RuntimeChannel.ts](node/RuntimeChannel.ts.md) (host port adaptation and listener removal), [RuntimeChannel.ts](browser/RuntimeChannel.ts.md) (host port adaptation and listener removal), [InternalTransport.ts](InternalTransport.ts.md) (structured-clone delivery and port listener cleanup).                | None demonstrated for this contribution. |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** One interface describes both host implementations without importing host modules [`RuntimePort.ts`](../../../../../../src/transport/RuntimePort.ts#L8). **Other files:** [RuntimeChannel.ts](node/RuntimeChannel.ts.md) (host port adaptation and listener removal), [RuntimeChannel.ts](browser/RuntimeChannel.ts.md) (host port adaptation and listener removal), [InternalTransport.ts](InternalTransport.ts.md) (structured-clone delivery and port listener cleanup). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [RuntimeChannel.ts](node/RuntimeChannel.ts.md)
- [RuntimeChannel.ts](browser/RuntimeChannel.ts.md)
- [InternalTransport.ts](InternalTransport.ts.md)
