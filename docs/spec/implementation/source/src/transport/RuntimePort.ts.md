# RuntimePort.ts — Source Report

> **Source:** [RuntimePort.ts](../../../../../../src/transport/RuntimePort.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The port surface a worker link runs on: post a message, take the one inbound handler, start, learn
of the far end going away, close. Both Node's `worker_threads` port and the browser's satisfy it
through a thin adapter; a linked pair is a channel.

## Linked requirements

| Source file                                                      | Specification IDs                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [RuntimePort.ts](../../../../../../src/transport/RuntimePort.ts) | [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) |

## Assumptions, dependencies, trust boundaries, and limits

- `onClose` is reliable on Node and best-effort in the browser; callers keep a timeout as backstop.

## Specification adherence

- One port shape for both hosts; the platform adapters differ, the contract does not ({{REQ:[`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y)}}).

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RUNTIME-4-B0N70Y`](../../../../specification/runtime/execution.md#req-runtime-4-b0n70y) | Covered               | **Here:** the platform-neutral shape. **Other files:** [../evm/p2pRuntime/node/P2pRuntimeChannel.ts.md](../evm/p2pRuntime/node/P2pRuntimeChannel.ts.md) and [../evm/p2pRuntime/browser/P2pRuntimeChannel.ts.md](../evm/p2pRuntime/browser/P2pRuntimeChannel.ts.md) adapt each host's port. | None.            |

## Related source reports

- [MessagePortTransport.ts.md](./MessagePortTransport.ts.md) — the transport over this port.
