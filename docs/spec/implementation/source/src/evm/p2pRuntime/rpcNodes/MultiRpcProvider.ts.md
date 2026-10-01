# MultiRpcProvider.ts — Source Report

> **Source:** [src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The runtime's single chain provider over the ordered RPC nodes. The chain signer, the manager
contract and the Clock use it. Every request, read or transaction, goes to the first node with an
open socket and moves to the next one when that node has none or loses it before answering.

## Key design decisions

1. **One rule for reads and sends:** [forward](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L133)
   tries the nodes in list order; a transaction is never sent to two nodes at once.
2. **All nodes down:** a request waits for the first node to reconnect
   ([waitForConnectedNode](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L177)); the outage is warned once
   ([onNodeLost](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L167)).
3. **Release:** [destroy](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L127) and
   [stopReconnecting](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L101) reject waiting requests, and a request in flight
   on a destroyed node is rejected too.
4. **Block events from sockets:** [\_getSubscriber](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L119)
   relays each node socket's `block` events, each new height once, so transaction waits do not poll.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                      |
| ------------ | ------------------------------------------------------------- |
| Inputs       | Requests from the signer, contracts and Clock; the node list. |
| Outputs      | JSON-RPC results; `block` events.                             |
| Owned state  | The nodes; requests waiting for any node.                     |
| Side effects | None beyond the nodes' sockets.                               |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                    | Specification IDs                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [MultiRpcProvider.ts](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts) | [`REQ-CHAINOBS-2-2NCSQ3`](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3) |

## Assumptions, dependencies, trust boundaries, and limits

- A node's own rejection is final; a node answering errors for every request is not skipped.
- Every listed node is trusted; answers are not cross-checked between nodes.

## Specification adherence

- First connected endpoint per request, failover on drop, no multi-endpoint broadcast.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-CHAINOBS-2-2NCSQ3`](../../../../../../specification/runtime/chain-observation.md#req-chainobs-2-2ncsq3) | Covered               | **Here:** [forward](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L133) picks the first connected node and moves on when it drops; [waitForConnectedNode](../../../../../../../../src/evm/p2pRuntime/rpcNodes/MultiRpcProvider.ts#L177) waits while none is connected. **Other files:** [RpcNodeProvider](RpcNodeProvider.ts.md) reports a dropped socket; [HostNonceManager](../../signer/HostNonceManager.ts.md) reconciles a failed broadcast. | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                            | Obligation                   | Public entry and setup                                                                                    | Oracle and forbidden effects                                                                                                                                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-multi-rpc-1-svggz5"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5` | Request routing and failover | Two real nodes behind cuttable proxies of one private chain; reads, transactions and block subscriptions. | The proxies record which node received each method; answers equal the node's own; no transaction reaches a second node while the first is connected; block events come without polling. | <a id="unit-test-multi-rpc-1-svggz5.p1"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P1` — transaction to the first node only; <a id="unit-test-multi-rpc-1-svggz5.p2"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P2` — transaction fails over while the first is cut; <a id="unit-test-multi-rpc-1-svggz5.p3"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P3` — transaction waits while no node is connected; <a id="unit-test-multi-rpc-1-svggz5.p4"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P4` — read fails over while the first is cut; <a id="unit-test-multi-rpc-1-svggz5.p5"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P5` — read in flight when the first node drops; <a id="unit-test-multi-rpc-1-svggz5.p6"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P6` — each block relayed once without polling; <a id="unit-test-multi-rpc-1-svggz5.p7"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P7` — transaction in flight when the first node drops after forwarding it; <a id="unit-test-multi-rpc-1-svggz5.p8"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P8` — transaction wait resolves from a reopened socket; <a id="unit-test-multi-rpc-1-svggz5.p9"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P9` — destroy rejects a request in flight; <a id="unit-test-multi-rpc-1-svggz5.p10"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P10` — destroy rejects a waiting request; <a id="unit-test-multi-rpc-1-svggz5.p11"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P11` — stopReconnecting rejects a waiting request; <a id="unit-test-multi-rpc-1-svggz5.p12"></a>`UNIT-TEST-MULTI-RPC-1-SVGGZ5.P12` — silent node marked dead and the read failed over. |

## Related source reports

- [RpcNodeProvider](RpcNodeProvider.ts.md), [RuntimeChainContext](../RuntimeChainContext.ts.md), [P2pRuntimeHostRoot](../../../rpc/internal/roots/P2pRuntimeHostRoot.ts.md).
