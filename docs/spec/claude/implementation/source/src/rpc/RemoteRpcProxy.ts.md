# RemoteRpcProxy.ts — Source Report

> **Source:** [src/rpc/RemoteRpcProxy.ts](../../../../../../../src/rpc/RemoteRpcProxy.ts) > **Status:** Authored — engineer verification pending.
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

The root typed proxy: substitutes every service on the local root with its RpcMethods-typed
sending surface (`remoteRpc.initHandshakeService.…`), caching one per-service proxy.

## Key design decisions

1. **Only services are reachable.** Accessing a non-service property throws — the remote surface cannot leak internal root fields ([#L44](../../../../../../../src/rpc/RemoteRpcProxy.ts#L44)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                          |
| ------------ | --------------------------------- |
| Inputs       | Service-name property accesses.   |
| Outputs      | Cached per-service typed proxies. |
| Owned state  | Proxy cache.                      |
| Side effects | None.                             |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                         | Specification IDs                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [RemoteRpcProxy.ts](../../../../../../../src/rpc/RemoteRpcProxy.ts) | [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Custom roots extend the same shape; their services join the typed surface automatically.

## Specification adherence

- Public-surface confinement at the type and runtime levels ([`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                              | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** service-only access with runtime enforcement. **Other files:** [MainRpcService](./MainRpcService.ts.md) defines the roster. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation           | Public entry and setup                 | Oracle and forbidden effects                                            | Required permutations                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | -------------------- | -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-remote-rpc-proxy-1-tzz729"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729` | Service-only surface | Access services and non-service fields | Services yield cached proxies; non-services throw; symbols pass through | <a id="unit-test-remote-rpc-proxy-1-tzz729.p1"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P1` — service access + cache identity; <a id="unit-test-remote-rpc-proxy-1-tzz729.p2"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P2` — non-service access throws; <a id="unit-test-remote-rpc-proxy-1-tzz729.p3"></a>`UNIT-TEST-REMOTE-RPC-PROXY-1-TZZ729.P3` — symbol passthrough |

## Related source reports

- [RpcHandleProxy](./RpcHandleProxy.ts.md), [MainRpcService](./MainRpcService.ts.md).
