# src/rpc/internal/services/hostRpc

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The hostRpc service owns its domain dependencies and endpoint construction. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [HostRpcRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcRpcMethods.ts) | [HostRpcRpcMethods.ts.md](./HostRpcRpcMethods.ts.md) |
| [HostRpcService.ts](../../../../../../../../../src/rpc/internal/services/hostRpc/HostRpcService.ts) | [HostRpcService.ts.md](./HostRpcService.ts.md) |

## Contents

- [HostRpcRpcMethods.ts](./HostRpcRpcMethods.ts.md)
- [HostRpcService.ts](./HostRpcService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
