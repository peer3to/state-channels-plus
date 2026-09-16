# src/rpc/internal/services/logger

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

LoggerService tracks attached stores, coalesces upload generations and forwards gossip through root connections. LoggerRpcMethods exposes upload and context-update sends. Shared routing owns request IDs and deadlines; LogUploader retains uploads, deltas, jitter and retries.

## Source inventory

| Source | Report |
| --- | --- |
| [LoggerRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/logger/LoggerRpcMethods.ts) | [LoggerRpcMethods.ts.md](./LoggerRpcMethods.ts.md) |
| [LoggerService.ts](../../../../../../../../../src/rpc/internal/services/logger/LoggerService.ts) | [LoggerService.ts.md](./LoggerService.ts.md) |

## Contents

- [LoggerRpcMethods.ts](./LoggerRpcMethods.ts.md)
- [LoggerService.ts](./LoggerService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
