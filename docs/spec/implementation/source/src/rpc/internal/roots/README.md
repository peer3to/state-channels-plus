# src/rpc/internal/roots — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Explicit RPC composition and its service dependencies. Network and internal capabilities remain separate; importing a file does not register endpoints.


## Source inventory

| Source | Report |
| --- | --- |
| [ContractExecutorRoot.ts](../../../../../../../../src/rpc/internal/roots/ContractExecutorRoot.ts) | [ContractExecutorRoot.ts.md](./ContractExecutorRoot.ts.md) |
| [P2pRuntimeClientRoot.ts](../../../../../../../../src/rpc/internal/roots/P2pRuntimeClientRoot.ts) | [P2pRuntimeClientRoot.ts.md](./P2pRuntimeClientRoot.ts.md) |
| [P2pRuntimeHostRoot.ts](../../../../../../../../src/rpc/internal/roots/P2pRuntimeHostRoot.ts) | [P2pRuntimeHostRoot.ts.md](./P2pRuntimeHostRoot.ts.md) |
| [WebRTCMainThreadBridge.ts](../../../../../../../../src/rpc/internal/roots/WebRTCMainThreadBridge.ts) | [WebRTCMainThreadBridge.ts.md](./WebRTCMainThreadBridge.ts.md) |
| [WebRTCWorkerBridgeRoot.ts](../../../../../../../../src/rpc/internal/roots/WebRTCWorkerBridgeRoot.ts) | [WebRTCWorkerBridgeRoot.ts.md](./WebRTCWorkerBridgeRoot.ts.md) |

## Contents

- [ContractExecutorRoot.ts](./ContractExecutorRoot.ts.md)
- [P2pRuntimeClientRoot.ts](./P2pRuntimeClientRoot.ts.md)
- [P2pRuntimeHostRoot.ts](./P2pRuntimeHostRoot.ts.md)
- [WebRTCMainThreadBridge.ts](./WebRTCMainThreadBridge.ts.md)
- [WebRTCWorkerBridgeRoot.ts](./WebRTCWorkerBridgeRoot.ts.md)

## Queue admission contributions

| Source report | Contribution | Requirements |
| --- | --- | --- |
| [P2pRuntimeHostRoot.ts](P2pRuntimeHostRoot.ts.md) | Startup reads the bound manager's maximum participant count and rejects nonpositive or unsafe integer values before constructing storage. | [`REQ-QSTORE-2-VYWJAQ`](../../../../../../specification/storage/queue.md#req-qstore-2-vywjaq) |
