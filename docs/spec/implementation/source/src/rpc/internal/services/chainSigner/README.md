# src/rpc/internal/services/chainSigner

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The chainSigner service owns its domain dependencies and endpoint construction. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [ChainSignerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerRpcMethods.ts) | [ChainSignerRpcMethods.ts.md](./ChainSignerRpcMethods.ts.md) |
| [ChainSignerService.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/ChainSignerService.ts) | [ChainSignerService.ts.md](./ChainSignerService.ts.md) |
| [chainSignerSerialization.ts](../../../../../../../../../src/rpc/internal/services/chainSigner/chainSignerSerialization.ts) | [chainSignerSerialization.ts.md](./chainSignerSerialization.ts.md) |

## Contents

- [ChainSignerRpcMethods.ts](./ChainSignerRpcMethods.ts.md)
- [ChainSignerService.ts](./ChainSignerService.ts.md)
- [chainSignerSerialization.ts](./chainSignerSerialization.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
