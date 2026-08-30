# LobbyMatchingRpcMethods.ts — Source Report

> **Source:** [src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

The RPC surface exposes one-way availability plus correlated `pick` and `commit` requests. Every method delegates validation and state changes to `LobbyMatchingService`; the RPC adapter owns no role, candidate, reservation, or retry state.

## Linked requirements

| Source file                                                                                                     | Specification IDs                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [LobbyMatchingRpcMethods.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingRpcMethods.ts) | [`REQ-LOBBY-4-E0TARV`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv) |

## Conformance traceability

| Requirement                                                                                                     | Implementation status | Evidence                                                                                              | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-LOBBY-4-E0TARV`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv) | Covered               | Availability is one-way; pick and commit return correlated results through the standard request path. | None.            |
