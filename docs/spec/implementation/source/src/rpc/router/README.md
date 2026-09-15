# src/rpc/router — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Shared request settlement, awaited service dispatch and category-specific ingress. Endpoint execution and response construction remain together in RpcDispatch. Each network manager owns one network router; each internal root owns one runtime router.


## Source inventory

| Source | Report |
| --- | --- |
| [ARpcRouter.ts](../../../../../../../src/rpc/router/ARpcRouter.ts) | [ARpcRouter.ts.md](./ARpcRouter.ts.md) |
| [NetworkRpcRouter.ts](../../../../../../../src/rpc/router/NetworkRpcRouter.ts) | [NetworkRpcRouter.ts.md](./NetworkRpcRouter.ts.md) |
| [InternalRpcRouter.ts](../../../../../../../src/rpc/router/InternalRpcRouter.ts) | [InternalRpcRouter.ts.md](./InternalRpcRouter.ts.md) |


## Contents

- [ARpcRouter.ts](./ARpcRouter.ts.md)
- [NetworkRpcRouter.ts](./NetworkRpcRouter.ts.md)
- [InternalRpcRouter.ts](./InternalRpcRouter.ts.md)
