# src/rpc/internal/services/webRTCBridge

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Callback endpoints deliver channel, state, ICE, data and errors to the worker facade. The shared bridge error projection preserves message, name and stack.

## Source inventory

| Source | Report |
| --- | --- |
| [WebRTCBridgeRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeRpcMethods.ts) | [WebRTCBridgeRpcMethods.ts.md](./WebRTCBridgeRpcMethods.ts.md) |
| [WebRTCBridgeService.ts](../../../../../../../../../src/rpc/internal/services/webRTCBridge/WebRTCBridgeService.ts) | [WebRTCBridgeService.ts.md](./WebRTCBridgeService.ts.md) |

## Contents

- [WebRTCBridgeRpcMethods.ts](./WebRTCBridgeRpcMethods.ts.md)
- [WebRTCBridgeService.ts](./WebRTCBridgeService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
