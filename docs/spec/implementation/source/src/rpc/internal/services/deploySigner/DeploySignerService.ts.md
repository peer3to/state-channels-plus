# DeploySignerService.ts — Source Report

> **Source:** [src/rpc/internal/services/deploySigner/DeploySignerService.ts](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Resolves the existing local deployment signer on each call. The accessor stays on the service and cannot be routed as an endpoint.

## Key design decisions

- Helpers and shared state remain on this non-routable service ([`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L15)).
- Per-invocation endpoint receivers retain their own sender ([`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L18)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The SDK root router, error hook and existing domain dependencies.                                                                               |
| Outputs      | A sender-bound endpoint receiver and delegated domain results.                                                                                  |
| Owned state  | References to existing domain owners and service-specific lifecycle hooks; no private request registry.                                         |
| Side effects | Address, nonce, name resolution, call and deployment transaction operations retain their existing local signer behavior and receipt projection. |

## Linked requirements

| Source file                                                                                                             | Specification IDs                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) |

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling

## Assumptions, dependencies, trust boundaries, and limits

Address, nonce, name resolution, call and deployment transaction operations retain their existing local signer behavior and receipt projection. Request versus send is selected explicitly by the caller. The service adds no peer admission policy, transport-specific error codec or router-wide queue.

## Specification adherence

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner See [`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L15).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling See [`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L15).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The service delegates state and ordering to the existing domain owner [`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L15). **Other files:** [DeploySignerRpcMethods.ts](DeploySignerRpcMethods.ts.md) (typed deployment signer endpoints), [LocalContractExecutorSigner.ts](../../../../evm/signer/LocalContractExecutorSigner.ts.md) (deployment transactions through the executor facade), [DeploymentBridgeSigner.ts](../../../../evm/signer/DeploymentBridgeSigner.ts.md) (public deployment signer reconstruction and bound calls), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                 | None demonstrated for this contribution. |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** The shared service boundary retains acknowledged requests and domain failure handling [`DeploySignerService.ts`](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts#L15). **Other files:** [DeploySignerRpcMethods.ts](DeploySignerRpcMethods.ts.md) (typed deployment signer endpoints), [LocalContractExecutorSigner.ts](../../../../evm/signer/LocalContractExecutorSigner.ts.md) (deployment transactions through the executor facade), [DeploymentBridgeSigner.ts](../../../../evm/signer/DeploymentBridgeSigner.ts.md) (public deployment signer reconstruction and bound calls), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [DeploySignerRpcMethods.ts](DeploySignerRpcMethods.ts.md)
- [LocalContractExecutorSigner.ts](../../../../evm/signer/LocalContractExecutorSigner.ts.md)
- [DeploymentBridgeSigner.ts](../../../../evm/signer/DeploymentBridgeSigner.ts.md)
- [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
