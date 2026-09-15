# src/rpc/internal/services/deploySigner

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The deploySigner service owns its domain dependencies and endpoint construction. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [DeploySignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerRpcMethods.ts) | [DeploySignerRpcMethods.ts.md](./DeploySignerRpcMethods.ts.md) |
| [DeploySignerService.ts](../../../../../../../../../src/rpc/internal/services/deploySigner/DeploySignerService.ts) | [DeploySignerService.ts.md](./DeploySignerService.ts.md) |

## Contents

- [DeploySignerRpcMethods.ts](./DeploySignerRpcMethods.ts.md)
- [DeploySignerService.ts](./DeploySignerService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
