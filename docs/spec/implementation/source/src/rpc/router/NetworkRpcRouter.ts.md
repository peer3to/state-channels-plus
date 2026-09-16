# NetworkRpcRouter.ts — Source Report

> **Source:** [src/rpc/router/NetworkRpcRouter.ts](../../../../../../../src/rpc/router/NetworkRpcRouter.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [RPC architecture](../../../../views/architecture/sdk/rpc/README.md)

## Responsibility and observable boundary

Owns network frame byte limits, response-first ingress, broadcast delivery, timeout hooks and peer-response admission. Each manager owns one instance. The inherited shared router owns all request IDs and pending settlement.

## Key design decisions

- Ingress awaits shared service dispatch, including asynchronous endpoint completion. Responses are still correlated before dispatch. Transport callbacks start each invocation independently, preserving concurrent and reentrant traffic.

- The constructor stores the explicit manager and performs no active work ([NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L13)). The dependency supplies the live root, connections, logging, time configuration and peer policy.
- Network transports convert host input before calling `onRpc`. The router receives strings and applies the UTF-8 byte limit before JSON parsing; conversion failures remain at the transport boundary.
- Broadcast reads the manager’s live connection list and preserves iteration and send-error behavior ([NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L43)).
- Responses from the original transport or authenticated same-peer replacement are admitted before consuming the pending entry ([NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L87)). A foreign peer is penalized through the manager.
- Network ingress remains admitted after transport close. Only the internal router filters closed input.

## Inputs, outputs, state, and side effects

| Aspect       | Boundary                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Inputs       | Host string/byte frames, network sender, logical outbound RPC and caller timeout options.          |
| Outputs      | Dispatch, admitted response settlement, or unchanged peer penalty/error handling.                  |
| Owned state  | Manager reference; pending entries exist only in the inherited shared owner.                       |
| Side effects | Broadcast sends, manager timeout tasks, manager close calls under an explicit policy, and logging. |

## Linked requirements

| Source file                                                                    | Specification IDs                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L1) | [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm), [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j), [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) |

[`REQ-RPC-2-SZDTTM` (Request lifecycle)](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm): retains peer response identity and manager timeout scheduling. [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j): retains byte-size admission, response-first parsing and dispatch. [`REQ-RPC-7-9CBSHK` (Guard semantics)](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk): rejects oversized input before parsing through existing peer policy.

## Assumptions, dependencies, trust boundaries, and limits

The manager finishes initialization before traffic is delivered. Internal transports cannot construct or enter this category through typed APIs. Same-peer recognition is response admission, not sender authentication. Unknown response IDs retain shared-router handling. No new retries, cancellation or global request queue are added.

## Specification adherence

The moved ingress and timeout hooks preserve the existing peer boundary. [P2PManager](../../P2PManager.ts.md) owns connections, discovery and penalties; [ARpcRouter](ARpcRouter.ts.md) owns shared settlement; [ANetworkRpcService](../network/ANetworkRpcService.ts.md) owns peer guards and reply policy.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                          | Gap / divergence            |
| --------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-RPC-2-SZDTTM`](../../../../../specification/peer-communication/rpc.md#req-rpc-2-szdttm) | Covered               | **Here:** [NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L65) uses manager scheduling and authenticates the responding peer before settlement. **Other files:** [P2PManager](../../P2PManager.ts.md) owns connections, discovery and penalties; [ARpcRouter](ARpcRouter.ts.md) owns shared settlement; [ANetworkRpcService](../network/ANetworkRpcService.ts.md) owns peer guards and reply policy.                   | None for this contribution. |
| [`REQ-RPC-6-E60S4J`](../../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Covered               | **Here:** [NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L99) preserves response-first ingress and distinct malformed/unknown-service/thrown-error consequences. **Other files:** [P2PManager](../../P2PManager.ts.md) owns connections, discovery and penalties; [ARpcRouter](ARpcRouter.ts.md) owns shared settlement; [ANetworkRpcService](../network/ANetworkRpcService.ts.md) owns peer guards and reply policy. | None for this contribution. |
| [`REQ-RPC-7-9CBSHK`](../../../../../specification/peer-communication/rpc.md#req-rpc-7-9cbshk) | Covered               | **Here:** [NetworkRpcRouter](../../../../../../../src/rpc/router/NetworkRpcRouter.ts#L103) checks UTF-8 bytes before parsing. **Other files:** [P2PManager](../../P2PManager.ts.md) owns connections, discovery and penalties; [ARpcRouter](ARpcRouter.ts.md) owns shared settlement; [ANetworkRpcService](../network/ANetworkRpcService.ts.md) owns peer guards and reply policy.                                                                | None for this contribution. |

## Component test obligations

| Unit test ID                                                                              | Obligation                                              | Public entry and setup                                          | Oracle and forbidden effects                                                                                                                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-network-rpc-router-1-xkt6dt"></a>`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT` | Network router ownership and shared receive forwarding. | Actual SDK services, loopback and real provider WebRTC channel. | One router and unchanged results, normalized frames, pending counts and receive-after-close behavior. Existing peer-boundary families retain byte-limit, timeout, foreign-response and retirement obligations. | <a id="unit-test-network-rpc-router-1-xkt6dt.p1"></a>`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P1`: A real SDK manager owns exactly one router shared by network services and loopback, and a self request leaves no pending entry.<br><a id="unit-test-network-rpc-router-1-xkt6dt.p2"></a>`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P2`: Real WebRTC string, Buffer and Uint8Array frames normalize to the same UTF-8 text; unknown responses leave unrelated pending work unchanged.<br><a id="unit-test-network-rpc-router-1-xkt6dt.p3"></a>`UNIT-TEST-NETWORK-RPC-ROUTER-1-XKT6DT.P3`: A closed real network transport still forwards late response frames, preserving network admission and leaving unrelated pending work unchanged. |

## Related source reports

[P2PManager](../../P2PManager.ts.md) owns connections, discovery and penalties; [ARpcRouter](ARpcRouter.ts.md) owns shared settlement; [ANetworkRpcService](../network/ANetworkRpcService.ts.md) owns peer guards and reply policy.
