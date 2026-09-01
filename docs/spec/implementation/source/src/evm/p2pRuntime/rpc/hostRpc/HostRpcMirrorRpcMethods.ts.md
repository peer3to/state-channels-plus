# HostRpcMirrorRpcMethods.ts — Source Report

> **Source:** [HostRpcMirrorRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorRpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Responsibility and observable boundary

One endpoint, `call(service, method, params, delivery, args)`: replay a `hostRpc.<service>.<method>(...params).<delivery>(...args)` call on the host's live `remoteRpc` and answer with its result.

## Key design decisions

- **A pure proxy.** Target semantics — omitted target runs on the host itself, a peer address relays — are the peer RPC handler's, untouched here.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                         |
| ------------ | ---------------------------------------------------------------- |
| Inputs       | A service and method name, params, a delivery verb and its args. |
| Outputs      | Whatever the replayed delivery returns.                          |
| Owned state  | None.                                                            |
| Side effects | The replayed peer RPC.                                           |

## Linked requirements

| Source file                                                                                                        | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [HostRpcMirrorRpcMethods.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorRpcMethods.ts) | [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Only addresses can be targets from the client; transports do not cross a port.

## Specification adherence

- The peer envelope is forwarded verbatim ({{REQ:[`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)}}).

## Conformance traceability

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                                       | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** the replay. **Other files:** [../../ClientHostRpc.ts.md](../../ClientHostRpc.ts.md) captures the call on the client. | None.            |

## Related source reports

- [HostRpcMirrorService.ts.md](./HostRpcMirrorService.ts.md)
- [../../ClientHostRpc.ts.md](../../ClientHostRpc.ts.md)
