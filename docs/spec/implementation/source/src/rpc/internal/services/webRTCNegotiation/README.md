# src/rpc/internal/services/webRTCNegotiation

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Negotiation endpoints delegate offer, answer, apply-answer, ICE, close and proxy operations to the broker. The service retains the bridge error projection and owns no duplicate connection map.

## Source inventory

| Source | Report |
| --- | --- |
| [WebRTCNegotiationRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationRpcMethods.ts) | [WebRTCNegotiationRpcMethods.ts.md](./WebRTCNegotiationRpcMethods.ts.md) |
| [WebRTCNegotiationService.ts](../../../../../../../../../src/rpc/internal/services/webRTCNegotiation/WebRTCNegotiationService.ts) | [WebRTCNegotiationService.ts.md](./WebRTCNegotiationService.ts.md) |

## Contents

- [WebRTCNegotiationRpcMethods.ts](./WebRTCNegotiationRpcMethods.ts.md)
- [WebRTCNegotiationService.ts](./WebRTCNegotiationService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
