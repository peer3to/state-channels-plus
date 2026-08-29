# RpcHandleProxy.ts — Source Report

> **Source:** [src/rpc/RpcHandleProxy.ts](../../../../../../src/rpc/RpcHandleProxy.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

The per-service typed proxy: any method access on `remoteRpc.<service>` fabricates an envelope
and returns the matching delivery handler, with the type layer mapping each RpcMethods signature
to fire-and-forget or request/response by its return type: `void` is a cast, a value is a request,
and `Promise<void>` offers both so a caller may await "done".

## Key design decisions

1. **Type safety is a sender-side property.** The mapped types prevent locally compiled code from constructing a wrong call — and deliberately claim nothing about wire data (type-safe caller vs Byzantine-safe receiver split, [../../../../specification/peer-communication/rpc.md](../../../../specification/peer-communication/rpc.md)).
2. **Symbols and `then` are exempt** so runtime inspection and promise-coercion probes don't fabricate envelopes ([#L46](../../../../../../src/rpc/RpcHandleProxy.ts#L46)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                     |
| ------------ | -------------------------------------------- |
| Inputs       | Property accesses on the service proxy.      |
| Outputs      | `RpcHandler` instances carrying envelopes.   |
| Owned state  | Per-service proxy cache (in RemoteRpcProxy). |
| Side effects | None until a delivery verb runs.             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                      | Specification IDs                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [RpcHandleProxy.ts](../../../../../../src/rpc/RpcHandleProxy.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Method-name string becomes the wire `method` verbatim; receiver-side existence is checked at dispatch.

## Specification adherence

- Typed construction of well-formed envelopes ([`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                            | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** envelope fabrication with service/method identity. **Other files:** [Rpc](./Rpc.ts.md) shapes; [RpcHandler](./RpcHandler.ts.md) delivery. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation           | Public entry and setup                  | Oracle and forbidden effects                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-rpc-handle-proxy-1-sm6m47"></a>`UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47` | Envelope fabrication | Access methods incl. symbols and `then` | Envelopes carry exact service/method/params; symbol/`then` access fabricates nothing | <a id="unit-test-rpc-handle-proxy-1-sm6m47.p1"></a>`UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P1` — method access → envelope; <a id="unit-test-rpc-handle-proxy-1-sm6m47.p2"></a>`UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P2` — symbol access exempt; <a id="unit-test-rpc-handle-proxy-1-sm6m47.p3"></a>`UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P3` — params passed verbatim; <a id="unit-test-rpc-handle-proxy-1-sm6m47.p4"></a>`UNIT-TEST-RPC-HANDLE-PROXY-1-SM6M47.P4` — `then` access exempt |

## Related source reports

- [RemoteRpcProxy](./RemoteRpcProxy.ts.md), [RpcHandler](./RpcHandler.ts.md).
