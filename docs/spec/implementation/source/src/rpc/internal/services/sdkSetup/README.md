# src/rpc/internal/services/sdkSetup

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The SDK setup service owns deployment completion and failed-build cleanup dependencies. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [SdkSetupRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupRpcMethods.ts) | [SdkSetupRpcMethods.ts.md](./SdkSetupRpcMethods.ts.md) |
| [SdkSetupService.ts](../../../../../../../../../src/rpc/internal/services/sdkSetup/SdkSetupService.ts) | [SdkSetupService.ts.md](./SdkSetupService.ts.md) |

## Contents

- [SdkSetupRpcMethods.ts](./SdkSetupRpcMethods.ts.md)
- [SdkSetupService.ts](./SdkSetupService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
