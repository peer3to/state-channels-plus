# AConsumerFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/state-machine-base.md](../../../../views/architecture/contracts/state-machine-base.md)

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

The integrator custody interface: `deposit`/`withdraw`/`openChannelGenesis` signatures the
manager delegates to — the funds trust boundary the protocol confines but does not sandbox.

## Key design decisions

1. **Interface-only by design:** custody semantics are integrator-owned under the composition rules.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                              |
| ------------ | ----------------------------------------------------- |
| Inputs       | Routed calls from the manager (delegatecall context). |
| Outputs      | State mutations/verdicts/events per operation group.  |
| Owned state  | None declared (shared layout via inheritance).        |
| Side effects | Events; escrow via consumer where applicable.         |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                            | Specification IDs                                                                               |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [AConsumerFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol) | [`REQ-ENFSM-2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                         | Implementation status | Evidence                                                                                                        | Gap / divergence       |
| ----------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [`REQ-ENFSM-2`](../../../../../specification/enforcement/execution-and-consumer.md#req-enfsm-2) | Covered               | **Here:** the confined delegation surface. **Other files:** reachability caveat in the state-machine-base view. | None at the interface. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
