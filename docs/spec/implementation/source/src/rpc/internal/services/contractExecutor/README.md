# src/rpc/internal/services/contractExecutor

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

The service owns initialization, the engine reference, dedicated monitoring and disposal policy. Endpoint methods expose engine operations and delegate ordering to the canonical engine mutex.

## Source inventory

| Source | Report |
| --- | --- |
| [ContractExecutorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorRpcMethods.ts) | [ContractExecutorRpcMethods.ts.md](./ContractExecutorRpcMethods.ts.md) |
| [ContractExecutorService.ts](../../../../../../../../../src/rpc/internal/services/contractExecutor/ContractExecutorService.ts) | [ContractExecutorService.ts.md](./ContractExecutorService.ts.md) |

## Contents

- [ContractExecutorRpcMethods.ts](./ContractExecutorRpcMethods.ts.md)
- [ContractExecutorService.ts](./ContractExecutorService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
