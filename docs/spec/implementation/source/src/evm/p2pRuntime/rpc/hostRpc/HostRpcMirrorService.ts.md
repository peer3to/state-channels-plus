# HostRpcMirrorService.ts — Source Report

> **Source:** [HostRpcMirrorService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

The host's peer RPC, mirrored to the main thread. The peer services live on the P2PManager router, not on this port's root, so a call from the main thread is replayed on the host's `remoteRpc` rather than dispatched here.

## Linked requirements

| Source file                                                                                                  | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [HostRpcMirrorService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorService.ts) | [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- The mirrored call keeps the peer envelope's service, method, params and delivery ({{REQ:[`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                         | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** the family's owner. **Other files:** [HostRpcMirrorRpcMethods.ts.md](./HostRpcMirrorRpcMethods.ts.md). | None.            |

## Related source reports

- [HostRpcMirrorRpcMethods.ts.md](./HostRpcMirrorRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
