# P2pSignerRpcMethods.ts — Source Report

> **Source:** [src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [Runtime and concurrency](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

Declares only the public p2pSigner endpoints: `sendTransaction`, `callView`, `connectToChannel`, `cancelConnectToChannel`, `leaveChannel`, `joinLobby`, `leaveLobby`, `joinChannel`, `topUpBalance`, `collectJoinChannelConfirmation`, `getChannelStatus`, `setIsLeader`, `disconnectFromPeers`, `signMessage`, `signTypedData`. Each receiver uses its service for dependencies and retains its invocation sender.

## Key design decisions

- Endpoint declarations are the concrete source of bound remote argument/result types ([`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L9)).
- Domain work delegates through the service; helpers are not added to the routable receiver ([`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L9)).

The signing endpoint decodes the tagged message before invoking the signer; encoded byte messages are not signed as hex text.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs       | Typed positional endpoint arguments and the service/sender receiver supplied by shared dispatch.                                                                                                                  |
| Outputs      | Domain values or awaited void acknowledgements through the shared response path.                                                                                                                                  |
| Owned state  | Invocation-local receiver only; domain state stays on the service or existing owner.                                                                                                                              |
| Side effects | P2P operations resolve readiness before decoding domain inputs. Balance, confirmation and join structures cross as named encoded values; targeted cancellation retains its channel identifier and Boolean result. |

## Linked requirements

| Source file                                                                                                          | Specification IDs                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L1) | [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz), [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) |

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner

## Assumptions, dependencies, trust boundaries, and limits

P2P operations resolve readiness before decoding domain inputs. Balance, confirmation and join structures cross as named encoded values; targeted cancellation retains its channel identifier and Boolean result. Constructor, base members, getters and service helpers are excluded by common descriptor dispatch. The trailing delivery operation decides whether a response is required; void does not imply fire-and-forget.

## Specification adherence

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz): The endpoint declarations and domain projections preserve argument and result meaning See [`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L9).
- [`REQ-RUNTIME-2-KBXKTG` (Ownership and ordering)](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg): The invocation receiver delegates to the canonical domain owner See [`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L9).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Gap / divergence                         |
| ------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [`REQ-RUNTIME-1-RSM6MZ`](../../../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz) | Covered               | **Here:** The endpoint declarations and domain projections preserve argument and result meaning [`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L9). **Other files:** [P2pSignerService.ts](P2pSignerService.ts.md) (readiness-gated P2P signer and manager dependencies), [ClientP2pSigner.ts](../../../../evm/signer/ClientP2pSigner.ts.md) (public P2P signer validations and bound calls), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation). | None demonstrated for this contribution. |
| [`REQ-RUNTIME-2-KBXKTG`](../../../../../../../specification/runtime/execution.md#req-runtime-2-kbxktg) | Covered               | **Here:** The invocation receiver delegates to the canonical domain owner [`P2pSignerRpcMethods.ts`](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts#L9). **Other files:** [P2pSignerService.ts](P2pSignerService.ts.md) (readiness-gated P2P signer and manager dependencies), [ClientP2pSigner.ts](../../../../evm/signer/ClientP2pSigner.ts.md) (public P2P signer validations and bound calls), [RpcDispatch.ts](../../../RpcDispatch.ts.md) (descriptor lookup and one response-send attempt), [AInternalRpcService.ts](../../AInternalRpcService.ts.md) (runtime domain errors and sender-bound invocation).                       | None demonstrated for this contribution. |

## Component test obligations

Exact test evidence belongs to verification reports. Existing family identities remain unchanged when their implementation owner moves.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [P2pSignerService.ts](P2pSignerService.ts.md)
- [ClientP2pSigner.ts](../../../../evm/signer/ClientP2pSigner.ts.md)
- [RpcDispatch.ts](../../../RpcDispatch.ts.md)
- [AInternalRpcService.ts](../../AInternalRpcService.ts.md)
