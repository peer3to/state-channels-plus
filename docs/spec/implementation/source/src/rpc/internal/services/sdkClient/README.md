# src/rpc/internal/services/sdkClient

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The callbacks service owns its domain dependencies and endpoint construction. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [SdkClientRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientRpcMethods.ts) | [SdkClientRpcMethods.ts.md](./SdkClientRpcMethods.ts.md) |
| [SdkClientService.ts](../../../../../../../../../src/rpc/internal/services/sdkClient/SdkClientService.ts) | [SdkClientService.ts.md](./SdkClientService.ts.md) |

## Contents

- [SdkClientRpcMethods.ts](./SdkClientRpcMethods.ts.md)
- [SdkClientService.ts](./SdkClientService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
