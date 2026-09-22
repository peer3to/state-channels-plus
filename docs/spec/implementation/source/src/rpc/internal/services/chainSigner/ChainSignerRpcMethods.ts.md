# ChainSignerRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Declares only the public chainSigner endpoints: `signTransaction`, `sendTransaction`, `signMessage`, `signTypedData`. Each receiver uses its service for dependencies and retains its invocation sender.

## Key design decisions

- Endpoint declarations are the concrete source of bound remote argument/result types ([`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L11)).
- Domain work delegates through the service; helpers are not added to the routable receiver ([`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L11)).

The gas usage endpoint holds no domain work of its own: it delegates to [ChainSignerService.gasUsageTable](ChainSignerService.ts.md), which answers the host signer's settled rows in a named field, so the client sees plain strings and numbers that cross the port unchanged.

The signing endpoint decodes the shared tagged message before invoking the signer.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed positional endpoint arguments and the service/sender receiver supplied by shared dispatch.                                                                                            |
| Outputs      | Domain values or awaited void acknowledgements through the shared response path.                                                                                                            |
| Owned state  | Invocation-local receiver only; domain state stays on the service or existing owner.                                                                                                        |
| Side effects | Transaction requests and full transaction responses use chainSignerSerialization. Byte messages retain their explicit string/bytes distinction; typed signing forwards the declared fields. |

## Linked requirements

| Source file                                                                                                                | Specification IDs                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg), [`REQ-SDK-ARCH-5-NSJYQT`](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner

## Assumptions, dependencies, trust boundaries, and limits

Transaction requests and full transaction responses use chainSignerSerialization. Byte messages retain their explicit string/bytes distinction; typed signing forwards the declared fields. Constructor, base members, getters and service helpers are excluded by common descriptor dispatch. The trailing delivery operation decides whether a response is required; void does not imply fire-and-forget.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning See [`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L11).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner See [`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L11).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Gap / divergence                                           |
| ------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The endpoint declarations and domain projections preserve argument and result meaning [`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L11). **Other files:** [ChainSignerService.ts](ChainSignerService.ts.md) (host chain signer ownership), [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md) (public chain signer reconstruction and bound calls), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution.                   |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The invocation receiver delegates to the canonical domain owner [`ChainSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L11). **Other files:** [ChainSignerService.ts](ChainSignerService.ts.md) (host chain signer ownership), [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md) (public chain signer reconstruction and bound calls), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                       | None demonstrated for this contribution.                   |
| [`REQ-SDK-ARCH-5-NSJYQT`](../../../../../../../specification/runtime/sdk.md#req-sdk-arch-5-nsjyqt)     | Partial               | **Here:** the one-call endpoint [`getGasUsageTable`](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts#L33). **Other files:** [ChainSignerService.ts](ChainSignerService.ts.md) holds the host signer and shapes the named-field result, [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md) is the client side of the same call.                                                                                                                                                                                                                                                                               | Counting and aggregation are the signer's and the table's. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [ChainSignerService.ts](ChainSignerService.ts.md)
- [ClientChainSigner.ts](../../../../evm/signer/ClientChainSigner.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
