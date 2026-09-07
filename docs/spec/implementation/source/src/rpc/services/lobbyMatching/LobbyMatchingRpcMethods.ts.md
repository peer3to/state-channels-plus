# LobbyMatchingRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

The RPC surface exposes one-way availability plus correlated `pick` and `commit` requests. Every method delegates validation and state changes to `LobbyMatchingService`; the RPC adapter owns no role, candidate, reservation, or retry state.

## Key design decisions

The otherwise unused topic parameter stays in pick and commit because LobbyRpcAdmissionGuard reads rpc.params[0]. Endpoint names and positional arguments stay unchanged. See [LobbyMatchingRpcMethods.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts#L33).

## Inputs, outputs, state, and side effects

Availability payloads and positional pick/commit arguments enter through the transport-bound RPC methods. Results and mutations come from the service; this adapter owns no mutable matching state.

## Linked requirements

| Source file                                                                                                     | Specification IDs                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [LobbyMatchingRpcMethods.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts) | [`REQ-LOBBY-4-E0TARV`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv) |

## Assumptions, dependencies, trust boundaries, and limits

Admission guards inspect the original topic at rpc.params[0]. Delegation must preserve endpoint names, argument order and synchronous/asynchronous return behavior.

## Specification adherence

The source contribution is limited to the linked requirements and operation described above; surrounding policy remains in the related owners.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement                                                                                                     | Implementation status | Evidence                                                                                              | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOBBY-4-E0TARV`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv) | Covered               | Availability is one-way; pick and commit return correlated results through the standard request path. | None.            |

## Component test obligations

Delegation and topic admission are exercised under [LobbyMatchingService.ts.md](LobbyMatchingService.ts.md). The endpoint comments add no independent runtime branch.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

[errorMessage.ts.md](../../../utils/errorMessage.ts.md)
