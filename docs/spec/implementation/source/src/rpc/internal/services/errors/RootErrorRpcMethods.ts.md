# RootErrorRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/errors/RootErrorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorRpcMethods.ts#L1) > **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

Exposes autonomous report and startup-failure endpoints.

## Key design decisions

Methods delegate to their service with the invoking transport; helpers remain on the service.

## Inputs, outputs, state, and side effects

Accepts serialized errors and preserves per-invocation sender identity.

## Linked requirements

| Source file                                                                                                     | Specification IDs                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RootErrorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorRpcMethods.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

Ownership is per connection. Lifecycle requirements cover initialized return, startup failure settlement and later failure reporting.

## Assumptions, dependencies, trust boundaries, and limits

Internal connections are created by their owners. Startup data and error projections must be cloneable. Browser callers supply their emitted worker entry URLs. These endpoints are not composed into the network root.

## Specification adherence

The owner relationships and error path are explicit. Request failures retain their response path; autonomous reports travel upward.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                   | Gap / divergence   |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** [RootErrorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorRpcMethods.ts#L1) provides the boundary described above. **Other files:** [Common creation](../../createRoot.ts.md) registers the exact parent/child connection and retains ownership.                             | None demonstrated. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** [RootErrorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorRpcMethods.ts#L1) provides the startup or failure behavior described above. **Other files:** [Common creation](../../createRoot.ts.md) awaits the lifecycle readiness promise and cleans up unsuccessful creation. | None demonstrated. |

## Component test obligations

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

[Common creation](../../createRoot.ts.md) owns startup coordination.
