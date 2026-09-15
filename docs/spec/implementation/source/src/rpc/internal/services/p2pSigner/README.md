# src/rpc/internal/services/p2pSigner

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The p2pSigner service owns its domain dependencies and endpoint construction. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [P2pSignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerRpcMethods.ts) | [P2pSignerRpcMethods.ts.md](./P2pSignerRpcMethods.ts.md) |
| [P2pSignerService.ts](../../../../../../../../../src/rpc/internal/services/p2pSigner/P2pSignerService.ts) | [P2pSignerService.ts.md](./P2pSignerService.ts.md) |

## Contents

- [P2pSignerRpcMethods.ts](./P2pSignerRpcMethods.ts.md)
- [P2pSignerService.ts](./P2pSignerService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
