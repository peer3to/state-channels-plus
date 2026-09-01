# ARpcMethods.ts — Source Report

> **Source:** [src/rpc/ARpcMethods.ts](../../../../../../src/rpc/ARpcMethods.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

The RpcMethods base: binds a dispatch to its sender transport and exposes the router's typed
remote surface — the only state an endpoint instance carries. Generic over the router, so the
same base serves a peer service under `P2PManager` and a worker-link service under `PortRpcRouter`.

## Key design decisions

1. **Per-dispatch, sender-bound instances.** Each frame gets a fresh instance holding only `senderTransport`, so endpoint code derives the caller from the authenticated transport, never from payload claims.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                    |
| ------------ | ------------------------------------------- |
| Inputs       | Sender transport + manager at construction. |
| Outputs      | —                                           |
| Owned state  | `senderTransport` for one dispatch.         |
| Side effects | None.                                       |

## Linked requirements

| Source file                                                | Specification IDs                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [ARpcMethods.ts](../../../../../../src/rpc/ARpcMethods.ts) | [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) |

## Assumptions, dependencies, trust boundaries, and limits

- Endpoints must treat `senderTransport.peerAddress` as the caller identity source ([`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)).

## Specification adherence

- Sender binding underpinning identity-bound dispatch ([`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6)).

## Conformance traceability

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                               | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`INV-RPC-1-SJS2T6`](../../../../specification/peer-communication/rpc.md#inv-rpc-1-sjs2t6) | Covered               | **Here:** transport binding per dispatch. **Other files:** authentication in [InitHandshakeService](./services/initHandshake/InitHandshakeService.ts.md); gating in [HandshakeCompletedGuard](./guards/HandshakeCompletedGuard.ts.md). | None.            |

## Component test obligations

| Unit test ID                                                                  | Obligation     | Public entry and setup                          | Oracle and forbidden effects                                          | Required permutations                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | -------------- | ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-arpc-methods-1-t4v713"></a>`UNIT-TEST-ARPC-METHODS-1-T4V713` | Sender binding | Construct per dispatch with distinct transports | Each instance reports exactly its own sender; no cross-dispatch state | <a id="unit-test-arpc-methods-1-t4v713.p1"></a>`UNIT-TEST-ARPC-METHODS-1-T4V713.P1` — distinct senders isolated; <a id="unit-test-arpc-methods-1-t4v713.p2"></a>`UNIT-TEST-ARPC-METHODS-1-T4V713.P2` — remoteRpc passthrough |

## Related source reports

- [ARpcService](./ARpcService.ts.md) (factory caller).
