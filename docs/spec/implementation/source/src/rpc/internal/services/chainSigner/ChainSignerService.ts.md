# ChainSignerService.ts — Source Report

> **Source:** [src/rpc/internal/services/chainSigner/ChainSignerService.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Holds the existing HostNonceManager for chain transaction and signing operations. It creates a sender-bound endpoint receiver without duplicating nonce or provider state.

## Key design decisions

- Helpers and shared state remain on this non-routable service ([`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11)).
- Per-invocation endpoint receivers retain their own sender ([`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L20)).
- The gas usage read is composed here, not in the routable methods class: the service asks the host signer's recorder for its settled rows and names the field ([`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L15)).

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | The SDK root router, error hook and existing domain dependencies.                                                                                                                           |
| Outputs      | A sender-bound endpoint receiver and delegated domain results.                                                                                                                              |
| Owned state  | References to existing domain owners and service-specific lifecycle hooks; no private request registry.                                                                                     |
| Side effects | Transaction requests and full transaction responses use chainSignerSerialization. Byte messages retain their explicit string/bytes distinction; typed signing forwards the declared fields. |

## Linked requirements

| Source file                                                                                                          | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L1) | [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59), [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er) |

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The paired endpoint methods define the serializable operation contract
- [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er): The service composes the settled gas usage read and its named field

## Assumptions, dependencies, trust boundaries, and limits

Transaction requests and full transaction responses use chainSignerSerialization. Byte messages retain their explicit string/bytes distinction; typed signing forwards the declared fields. Request versus send is selected explicitly by the caller. The service adds no peer admission policy, transport-specific error codec or router-wide queue.

## Specification adherence

- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The service delegates state and ordering to the existing domain owner See [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11).
- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59): The shared service boundary retains acknowledged requests and domain failure handling See [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11).
- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The paired endpoint methods define the serializable operation contract See [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11).
- [`REQ-SDK-ARCH-6-8DE4ER` (Chain spending is observable)](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er): The settled gas usage read and its named field live on this non-routable service See [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L15).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Gap / divergence                                             |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The service delegates state and ordering to the existing domain owner [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11). **Other files:** [ChainSignerRpcMethods.ts](ChainSignerRpcMethods.ts.md) (serialized chain signing endpoints), [HostNonceManager.ts](../../../../evm/signer/HostNonceManager.ts.md) (host-owned transaction nonces), [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md) (public chain signer reconstruction and bound calls), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                 | None demonstrated for this contribution.                     |
| [`REQ-RUNTIME-3-VQXW59`](../../../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59) | Covered               | **Here:** The shared service boundary retains acknowledged requests and domain failure handling [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11). **Other files:** [ChainSignerRpcMethods.ts](ChainSignerRpcMethods.ts.md) (serialized chain signing endpoints), [HostNonceManager.ts](../../../../evm/signer/HostNonceManager.ts.md) (host-owned transaction nonces), [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md) (public chain signer reconstruction and bound calls), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution.                     |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The paired endpoint methods define the serializable operation contract [`ChainSignerService.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L11). **Other files:** [ChainSignerRpcMethods.ts](ChainSignerRpcMethods.ts.md) (serialized chain signing endpoints), [HostNonceManager.ts](../../../../evm/signer/HostNonceManager.ts.md) (host-owned transaction nonces), [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md) (public chain signer reconstruction and bound calls), [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md) (SDK domain and common error service composition), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                | None demonstrated for this contribution.                     |
| [`REQ-SDK-ARCH-6-8DE4ER`](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-6-8de4er)     | Partial               | **Here:** the settled read and its named field in [`gasUsageTable`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts#L15). **Other files:** [ChainSignerRpcMethods.ts](ChainSignerRpcMethods.ts.md) exposes it as one endpoint call, [HostNonceManager.ts](../../../../evm/signer/HostNonceManager.ts.md) owns the recorder, [GasUsageRecorder.ts](../../../../evm/gasUsage/GasUsageRecorder.ts.md) settles and snapshots.                                                                                                                                                                                                                                                                                                                                         | Counting, aggregation and the disposal report are elsewhere. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ChainSignerRpcMethods.ts](ChainSignerRpcMethods.ts.md)
- [HostNonceManager.ts](../../../../evm/signer/HostNonceManager.ts.md)
- [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md)
- [P2pRuntimeHostRoot.ts](../../roots/P2pRuntimeHostRoot.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
