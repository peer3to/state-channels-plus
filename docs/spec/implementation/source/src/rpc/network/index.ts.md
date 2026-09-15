# index.ts — Source Report

> **Source:** [src/rpc/network/index.ts](../../../../../../../src/rpc/network/index.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../../views/architecture/sdk/rpc/README.md)

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

Network-category exports for the service base, explicit peer root and manifest types. Importing this file adds no services to a root and exports no internal service. The package RPC barrel keeps its base-first initialization order.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents                   |
| ------------ | -------------------------- |
| Inputs       | —                          |
| Outputs      | Re-exports.                |
| Owned state  | None.                      |
| Side effects | Module-init ordering only. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                               | Specification IDs                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [index.ts](../../../../../../../src/rpc/network/index.ts) | [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) |

## Assumptions, dependencies, trust boundaries, and limits

- Import order is deliberate where noted in-source.

## Specification adherence

- [`REQ-RPC-1-FF89Z0` (Typed wire contract)](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0): exposes the network service and root types without registering or exposing internal endpoints.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                       | Implementation status | Evidence                                                                                                                                                                                                                                                                                                              | Gap / divergence            |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [`REQ-RPC-1-FF89Z0`](../../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0) | Covered               | **Here:** [network exports](../../../../../../../src/rpc/network/index.ts#L1) retain explicit network root and service types. **Other files:** [ANetworkRpcService](ANetworkRpcService.ts.md) checks the network service boundary; [MainRpcService](MainRpcService.ts.md) explicitly constructs the peer service set. | None for this contribution. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- The exported modules' own reports.
