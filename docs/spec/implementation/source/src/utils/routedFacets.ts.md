# routedFacets.ts — Source Report

> **Source:** [src/utils/routedFacets.ts](../../../../../../src/utils/routedFacets.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../views/architecture/contracts/manager-and-facets.md)

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

Owns the one production list of the eight routed facet factories and artifacts. Deployment and
selector fixtures consume this list.

## Key design decisions

1. The inventory contains no test exclusions and no manager error composition.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                        |
| ------------ | ----------------------------------------------- |
| Inputs       | Generated factories and compiled artifacts.     |
| Outputs      | Ordered routed facet definitions and artifacts. |
| Owned state  | The eight-facet inventory.                      |
| Side effects | None.                                           |

## Linked requirements

| Source file                                                    | Specification IDs                                                                                                                                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [routedFacets.ts](../../../../../../src/utils/routedFacets.ts) | [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje), [`REQ-CONTRACT-ARCH-5-QT17P1`](../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) |

## Assumptions, dependencies, trust boundaries, and limits

- Constructor order and this list must remain aligned.

## Specification adherence

- Gives deployment and verification one routed-facet owner.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

| Requirement / invariant                                                                                       | Implementation status | Evidence                                                                                                       | Gap / divergence                                           |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`REQ-CONTRACT-ARCH-4-FZ3CJE`](../../../../specification/enforcement/contracts.md#req-contract-arch-4-fz3cje) | Partial               | **Here:** complete ordered facet inventory. **Other files:** deployment consumes its artifacts.                | Address compatibility remains a deployment trust decision. |
| [`REQ-CONTRACT-ARCH-5-QT17P1`](../../../../specification/enforcement/contracts.md#req-contract-arch-5-qt17p1) | Partial               | **Here:** names every routed facet once. **Other files:** selector routing tests reconcile every ABI function. | Consumer operations remain integrator-owned.               |

## Component test obligations

Evidence maps to [`UNIT-TEST-MANAGER-PROXY-2-KJRMB8.P30`](../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md#unit-test-manager-proxy-2-kjrmb8.p30); this inventory does not own a second test root.

## Related source reports

- [StateChannelManagerProxy.sol](../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol.md).
