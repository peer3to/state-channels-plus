# src/rpc/internal — Subsystem

> **Status:** Authored — engineer verification pending.

## Responsibility and interactions

Each runtime endpoint owns one root and one domain-service instance per capability. Its connections share that root. The router owns request settlement; services own domain execution, errors and sender-dependent actions. Each logger service tracks attached stores and forwards upload gossip through its root connections.

Common services include upward error reporting through `RootErrorService`. Common services provide capabilities on every internal endpoint: `LoggerService` owns logger binding, context and collection; `RuntimeLifecycleService` owns child readiness, child-first disposal and quiescence, and repeated cleanup completion. Concrete roots explicitly compose the remaining domain services. Shared implementation consists of connection ownership, routing, dispatch and proxies; root close subscriptions let services release their own resources. Logger connection activation remains at the existing initialization points.

## Source inventory

| Source | Report |
| --- | --- |
| [AInternalRpcMethods.ts](../../../../../../../src/rpc/internal/AInternalRpcMethods.ts) | [AInternalRpcMethods.ts.md](./AInternalRpcMethods.ts.md) |
| [AInternalRpcRoot.ts](../../../../../../../src/rpc/internal/AInternalRpcRoot.ts) | [AInternalRpcRoot.ts.md](./AInternalRpcRoot.ts.md) |
| [AInternalRpcService.ts](../../../../../../../src/rpc/internal/AInternalRpcService.ts) | [AInternalRpcService.ts.md](./AInternalRpcService.ts.md) |
| [RemoteRoot.ts](../../../../../../../src/rpc/internal/RemoteRoot.ts) | [RemoteRoot.ts.md](./RemoteRoot.ts.md) |
| [createRoot.ts](../../../../../../../src/rpc/internal/createRoot.ts) | [createRoot.ts.md](./createRoot.ts.md) |
| [errorWire.ts](../../../../../../../src/rpc/internal/errorWire.ts) | [errorWire.ts.md](./errorWire.ts.md) |
| [rootWorkerGlobals.ts](../../../../../../../src/rpc/internal/rootWorkerGlobals.ts) | [rootWorkerGlobals.ts.md](./rootWorkerGlobals.ts.md) |

## Contents

- [AInternalRpcMethods.ts](./AInternalRpcMethods.ts.md)
- [AInternalRpcRoot.ts](./AInternalRpcRoot.ts.md)
- [AInternalRpcService.ts](./AInternalRpcService.ts.md)
- [RemoteRoot.ts](./RemoteRoot.ts.md)
- [createRoot.ts](./createRoot.ts.md)
- [errorWire.ts](./errorWire.ts.md)
- [rootWorkerGlobals.ts](./rootWorkerGlobals.ts.md)

## Assumptions and limits

Connections are created and registered by the owning SDK endpoint. Domain methods use the common dispatcher and explicit request/send operations. Platform adapters perform host API conversion only. Final ownership cleanup closes root connections. Abort fully disposes the executor in both placements; later calls reject.

## Integration test obligations

| Integration test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| --- | --- | --- | --- | --- |
| <a id="integration-test-runtime-rpc-1-3j92x6"></a>`INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6` | SDK parent/child connection controls across local and worker placement. | Actual SDK-owned roots and connected domain services; narrow controls act on those connections. | The typed host control holds only the selected real executor reply, independent SDK calls complete, release settles the correct result and leaves no owned pending request. | <a id="integration-test-runtime-rpc-1-3j92x6.p1"></a>`INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6.P1`: Controls the actual executor connection through the host harness service.<br><a id="integration-test-runtime-rpc-1-3j92x6.p2"></a>`INTEGRATION-TEST-RUNTIME-RPC-1-3J92X6.P2`: Controls an SDK worker's executor connection through the same harness service. |

## Root creation source inventory

| Source | Report |
| --- | --- |
| [createRoot.ts](../../../../../../../src/rpc/internal/createRoot.ts) | [createRoot.ts.md](createRoot.ts.md) |
| [rootWorkerGlobals.ts](../../../../../../../src/rpc/internal/rootWorkerGlobals.ts) | [rootWorkerGlobals.ts.md](rootWorkerGlobals.ts.md) |

Platform implementations: [Node](./node/README.md), [browser](./browser/README.md).

| [threadName.ts](../../../../../../../src/rpc/internal/threadName.ts) | [threadName.ts.md](./threadName.ts.md) |
