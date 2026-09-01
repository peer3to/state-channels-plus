# P2pRuntimeClientRoot.ts — Source Report

> **Source:** [P2pRuntimeClientRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeClientRoot.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

What the main thread serves to the sdk host over the runtime port: the host's one-way pushes (bus
events, host errors) and log control. `RuntimeEventSink` is what the client implements to receive
the pushes.

## Key design decisions

- **Pushes are services too.** What used to be two message types and a switch on the client is one
  service with two `void` methods, delivered as casts.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                |
| ------------ | --------------------------------------- |
| Inputs       | The router, the sink, the owner logger. |
| Outputs      | The composed services; the manifest.    |
| Owned state  | The service instances.                  |
| Side effects | None of its own.                        |

## Linked requirements

| Source file                                                                                       | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [P2pRuntimeClientRoot.ts](../../../../../../../../src/evm/p2pRuntime/rpc/P2pRuntimeClientRoot.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) |

## Assumptions, dependencies, trust boundaries, and limits

- The host is trusted; a push is applied, never validated.

## Specification adherence

- The same root whether the host is inline or threaded ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                                | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** composed identically for both deployments. **Other files:** [../P2pRuntimeClient.ts.md](../P2pRuntimeClient.ts.md) builds it. | None.            |

## Related source reports

- [runtimeEvents/RuntimeEventsService.ts.md](./runtimeEvents/RuntimeEventsService.ts.md)
- [P2pRuntimeHostRoot.ts.md](./P2pRuntimeHostRoot.ts.md) — the other end.
