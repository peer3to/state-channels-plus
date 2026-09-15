# SdkSetupService.ts — Source Report

> **Source:** [src/rpc/internal/services/sdkSetup/SdkSetupService.ts](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Completes SDK deployment through the existing host build operation. On failure, attempts host cleanup and preserves the original initialization error.

## Key design decisions

- Helpers and shared state remain on this non-routable service ([`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L35)).
- Per-invocation endpoint receivers retain their own sender ([`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L27)).

Failed application assembly disposes the root while retaining its response connection. Its original failure response is sent before lifecycle closes that connection; cleanup failure does not replace the assembly error.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The SDK root router, error hook and existing domain dependencies.                                                                                                                                                                                                             |
| Outputs      | A sender-bound endpoint receiver and delegated domain results.                                                                                                                                                                                                                |
| Owned state  | References to existing domain owners and service-specific lifecycle hooks; no private request registry.                                                                                                                                                                       |
| Side effects | Common startup has already signalled communication readiness. deployComplete builds the application runtime after setupP2pRuntime performs the deployments. A failed build invokes existing cleanup, logs a cleanup failure separately and rethrows the original build error. |

## Linked requirements

| Source file                                                                                                 | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling

## Assumptions, dependencies, trust boundaries, and limits

Common startup has already signalled communication readiness. deployComplete builds the application runtime after setupP2pRuntime performs the deployments. A failed build invokes existing cleanup, logs a cleanup failure separately and rethrows the original build error. Request versus send is selected explicitly by the caller. The service adds no peer admission policy, transport-specific error codec or router-wide queue.

## Specification adherence

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner See [`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L35).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling See [`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L35).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The service delegates state and ordering to the existing domain owner [`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L35). **Other files:** [SdkSetupRpcMethods.ts](SdkSetupRpcMethods.ts.md) (typed SDK deployment completion endpoint), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK graph construction and deployment/final disposal order), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                 | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** The shared service boundary retains acknowledged requests and domain failure handling [`SdkSetupService.ts`](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts#L35). **Other files:** [SdkSetupRpcMethods.ts](SdkSetupRpcMethods.ts.md) (typed SDK deployment completion endpoint), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK graph construction and deployment/final disposal order), [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md) (public client mirrors, readiness and teardown), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [SdkSetupRpcMethods.ts](SdkSetupRpcMethods.ts.md)
- [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md)
- [P2pRuntimeClientRoot.ts](../../roots/P2pRuntimeClientRoot.ts.md)
- [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
