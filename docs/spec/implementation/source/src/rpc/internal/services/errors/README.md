# src/rpc/internal/services/errors

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Every internal root composes this error service. Request failures return to callers; autonomous errors travel through parent connections.

## Source inventory

| Source | Report |
| --- | --- |
| [RootErrorRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorRpcMethods.ts) | [RootErrorRpcMethods.ts.md](./RootErrorRpcMethods.ts.md) |
| [RootErrorService.ts](../../../../../../../../../src/rpc/internal/services/errors/RootErrorService.ts) | [RootErrorService.ts.md](./RootErrorService.ts.md) |
