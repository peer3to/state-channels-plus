# LobbyMatchingTypes.ts — Source Report

> **Source:** [src/rpc/services/lobbyMatching/LobbyMatchingTypes.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingTypes.ts)  
> **Status:** Authored — engineer verification pending.

## Responsibility and observable boundary

This file defines the serializable lobby protocol values: roles, availability, accepted/busy/rejected pick results, commitment acknowledgement, service options, public join options, and the committed match transcript. Public options carry the opening amount and an optional nullable matching timeout; absent or null means no matching deadline. `LobbyMatch` contains addresses, one attempt nonce, and both fresh challenges. It deliberately contains no channel ID.

## Linked requirements

| Source file                                                                                           | Specification IDs                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LobbyMatchingTypes.ts](../../../../../../../../src/rpc/services/lobbyMatching/LobbyMatchingTypes.ts) | [`INV-LOBBY-1-TW7RZT`](../../../../../../specification/peer-communication/lobby-matching.md#inv-lobby-1-tw7rzt), [`REQ-LOBBY-4-E0TARV`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv) |

## Linked requirements and conformance

| Requirement                                                                                                     | Implementation status | Evidence                                                                   | Gap / divergence |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- | ---------------- |
| [`INV-LOBBY-1-TW7RZT`](../../../../../../specification/peer-communication/lobby-matching.md#inv-lobby-1-tw7rzt) | Covered               | The public match type has no channel-ID field.                             | None.            |
| [`REQ-LOBBY-4-E0TARV`](../../../../../../specification/peer-communication/lobby-matching.md#req-lobby-4-e0tarv) | Covered               | Pick and commit types carry correlated attempt, epoch, and challenge data. | None.            |
