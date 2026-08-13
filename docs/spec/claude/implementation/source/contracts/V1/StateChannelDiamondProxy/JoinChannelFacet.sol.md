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

| Source file                                                                                                | Specification IDs                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [JoinChannelFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol) | [`REQ-ENFADM-1-V926CA`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca), [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp), [`INV-ENFADM-1-H53AQY`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy) |

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

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                                                                                                                                                                                                               | Gap / divergence |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| [`REQ-ENFADM-1-V926CA`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-1-v926ca) | Covered               | **Here:** self-submission, pins, expiry, unanimity checks.                                                                                                                                                                                                                                             | None.            |
| [`REQ-ENFADM-2-K6K9SP`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-2-k6k9sp) | Covered               | **Here:** the membership split + disputed-fork gate both directions.                                                                                                                                                                                                                                   | None.            |
| [`INV-ENFADM-1-H53AQY`](../../../../../specification/enforcement/admission-and-funds.md#inv-enfadm-1-h53aqy) | Covered               | **Here:** the appended JOIN block advancing head/totals. **Other files:** composable deposit on the proxy.                                                                                                                                                                                             | None.            |
| [`REQ-ENFADM-3-6A3BEB`](../../../../../specification/enforcement/admission-and-funds.md#req-enfadm-3-6a3beb) | Covered               | **Here:** deposits flow only through the atomic composable path into the consumer adapter; a failing deposit fails the join per composition mode. **Other files:** [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md) `depositAssetsComposable`, [AConsumerFacet](./AConsumerFacet.sol.md). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                              | Obligation      | Public entry and setup                                     | Oracle and forbidden effects                                                                                | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-join-channel-facet-1-vbjy1a"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A` | Admission gates | Join/top-up under every gate violation and the valid paths | Only correctly pinned, signed, membership-correct submissions append; each violation reverts with its error | <a id="unit-test-join-channel-facet-1-vbjy1a.p1"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P1` — zero-channel-id revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p2"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P2` — valid join; <a id="unit-test-join-channel-facet-1-vbjy1a.p3"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P3` — valid top-up; <a id="unit-test-join-channel-facet-1-vbjy1a.p4"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P4` — fork-pin race; <a id="unit-test-join-channel-facet-1-vbjy1a.p5"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P5` — disputed-fork join; <a id="unit-test-join-channel-facet-1-vbjy1a.p6"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P6` — wrong-submitter revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p7"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P7` — expired-deadline revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p8"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P8` — join existing-participant revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p9"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P9` — top-up unknown-participant revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p10"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P10` — participant-signature revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p11"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P11` — threshold-shortfall revert; <a id="unit-test-join-channel-facet-1-vbjy1a.p12"></a>`UNIT-TEST-JOIN-CHANNEL-FACET-1-VBJY1A.P12` — snapshot-pin race |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
