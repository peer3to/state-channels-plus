# RuntimeEventsService.ts — Source Report

> **Source:** [RuntimeEventsService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The host's one-way traffic to the client as a service: bus emissions and autonomous host errors. Nothing here is answered.

## Linked requirements

| Source file                                                                                                        | Specification IDs                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RuntimeEventsService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/runtimeEvents/RuntimeEventsService.ts) | [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- Events reach the client the same way inline and threaded ({{REQ:[`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak)}}).
- A host error before readiness settles readiness ({{REQ:[`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)}}).

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                 | Gap / divergence |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RUNTIME-1-AKRHAK`](../../../../../../../specification/runtime/execution.md#inv-runtime-1-akrhak) | Covered               | **Here:** the family's owner. **Other files:** [RuntimeEventsRpcMethods.ts.md](./RuntimeEventsRpcMethods.ts.md).                         | None.            |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Partial               | **Here:** delivers the error. **Other files:** [../../P2pRuntimeClient.ts.md](../../P2pRuntimeClient.ts.md) rejects `ready` or notifies. | None here.       |

## Related source reports

- [RuntimeEventsRpcMethods.ts.md](./RuntimeEventsRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeClientRoot.ts.md](../P2pRuntimeClientRoot.ts.md) — the root that composes it.
