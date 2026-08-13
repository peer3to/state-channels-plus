# JoinChannelFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md), [architecture/contracts/architecture.md](../../../../views/architecture/contracts/architecture.md)

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

Post-open admission: `joinChannel`/`topUpBalance` share one path — submitter-is-participant,
unexpired, expected fork/snapshot pins, membership split (absent for join incl. undisputed-fork
gate; present for top-up), participant + unanimous union signatures, atomic composable deposit,
appended inbound JOIN block.

## Key design decisions

1. **One `_processJoinChannel(…, isTopUp)`** keeps the two admission cases from drifting apart — the membership split is a flag check, everything else shared.

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

| Source file                                                                                                | Specification IDs                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JoinChannelFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol) | [`REQ-ENFADM-1`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1), [`REQ-ENFADM-2`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2), [`INV-ENFADM-1`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1) |

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

| Requirement / invariant                                                                        | Implementation status | Evidence                                                                                                                                                                                                                                                                                               | Gap / divergence |
| ---------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-ENFADM-1`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1) | Covered               | **Here:** self-submission, pins, expiry, unanimity checks.                                                                                                                                                                                                                                             | None.            |
| [`REQ-ENFADM-2`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2) | Covered               | **Here:** the membership split + disputed-fork gate both directions.                                                                                                                                                                                                                                   | None.            |
| [`INV-ENFADM-1`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1) | Covered               | **Here:** the appended JOIN block advancing head/totals. **Other files:** composable deposit on the proxy.                                                                                                                                                                                             | None.            |
| [`REQ-ENFADM-3`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3) | Covered               | **Here:** deposits flow only through the atomic composable path into the consumer adapter; a failing deposit fails the join per composition mode. **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) `depositAssetsComposable`, [AConsumerFacet](./AConsumerFacet.sol.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                | Obligation      | Public entry and setup                                     | Oracle and forbidden effects                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-join-channel-facet-1"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1` | Admission gates | Join/top-up under every gate violation and the valid paths | Only correctly pinned, signed, membership-correct submissions append; each violation reverts with its error | <a id="unit-test-join-channel-facet-1.p1"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1.P1` — each named revert; <a id="unit-test-join-channel-facet-1.p2"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1.P2` — valid join; <a id="unit-test-join-channel-facet-1.p3"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1.P3` — valid top-up; <a id="unit-test-join-channel-facet-1.p4"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1.P4` — pin races; <a id="unit-test-join-channel-facet-1.p5"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1.P5` — disputed-fork join |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
