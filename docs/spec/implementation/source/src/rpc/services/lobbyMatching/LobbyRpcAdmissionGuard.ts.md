# LobbyRpcAdmissionGuard.ts — Source Report

> **Source:** [src/rpc/services/lobbyMatching/LobbyRpcAdmissionGuard.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyRpcAdmissionGuard.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

This guard admits advertisements only while the local instance is actively matching on the same caller topic. Correlated pick and commit requests for the still-active topic may reach the service after commitment so they receive an explicit rejected result. Other rejected frames do not reach matching state. Repeated rejected work is counted per transport and the transport is closed after the fixed abuse bound.

## Linked requirements

| Source file                                                                                                   | Specification IDs                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LobbyRpcAdmissionGuard.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyRpcAdmissionGuard.ts) | [`REQ-LOBBY-2-TSWRV6`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-2-tswrv6), [`REQ-LOBBY-8-31BE0F`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f) |

## Conformance traceability

| Requirement                                                                                                     | Implementation status | Evidence                                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-LOBBY-2-TSWRV6`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-2-tswrv6) | Covered               | Status and exact-topic admission precede service dispatch; the handshake guard runs first. | None.            |
| [`REQ-LOBBY-8-31BE0F`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-8-31be0f) | Covered               | Inactive, stale-topic, and repeatedly abusive traffic cannot mutate lobby state.           | None.            |
