# HostRpcMirrorService.ts — Source Report

> **Source:** [HostRpcMirrorService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../../views/architecture/sdk/runtime-and-concurrency.md)

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

The host's peer RPC, mirrored to the main thread. The peer services live on the P2PManager router, not on this port's root, so a call from the main thread is replayed on the host's `remoteRpc` rather than dispatched here.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                            |
| ------------ | ----------------------------------- |
| Inputs       | The router and the live host.       |
| Outputs      | The endpoints of its methods class. |
| Owned state  | A reference to the live host.       |
| Side effects | None of its own.                    |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                  | Specification IDs                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| [HostRpcMirrorService.ts](../../../../../../../../../src/evm/p2pRuntime/rpc/hostRpc/HostRpcMirrorService.ts) | [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Dispatched only over a trusted port; no guards.

## Specification adherence

- The mirrored call keeps the peer envelope's service, method, params and delivery ({{REQ:[`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)}}).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                             | Implementation status | Evidence                                                                                                         | Gap / divergence |
| --------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** the family's owner. **Other files:** [HostRpcMirrorRpcMethods.ts.md](./HostRpcMirrorRpcMethods.ts.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

_None: exercised through the obligations of the files listed under Related source reports._

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [HostRpcMirrorRpcMethods.ts.md](./HostRpcMirrorRpcMethods.ts.md) — the endpoints.
- [../P2pRuntimeHostRoot.ts.md](../P2pRuntimeHostRoot.ts.md) — the root that composes it.
