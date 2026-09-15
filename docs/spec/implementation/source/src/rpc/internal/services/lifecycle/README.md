# src/rpc/internal/services/lifecycle

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Every internal root composes this lifecycle service. Readiness promises are per child; disposal and quiescence cascade to children before local operations. The paired RpcMethods class contains only public endpoints; each receiver retains its invocation sender. SDK readiness checks, encoded values and operation timeout choices remain with the domain callers.

## Source inventory

| Source | Report |
| --- | --- |
| [RuntimeLifecycleRpcMethods.ts](../../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleRpcMethods.ts) | [RuntimeLifecycleRpcMethods.ts.md](./RuntimeLifecycleRpcMethods.ts.md) |
| [RuntimeLifecycleService.ts](../../../../../../../../../src/rpc/internal/services/lifecycle/RuntimeLifecycleService.ts) | [RuntimeLifecycleService.ts.md](./RuntimeLifecycleService.ts.md) |

## Contents

- [RuntimeLifecycleRpcMethods.ts](./RuntimeLifecycleRpcMethods.ts.md)
- [RuntimeLifecycleService.ts](./RuntimeLifecycleService.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.
