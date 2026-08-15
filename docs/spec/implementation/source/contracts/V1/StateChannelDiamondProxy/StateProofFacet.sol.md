# StateProofFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol) > **Status:** Authored — engineer verification pending.
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

The state-proof predicate family: full verification against auditing data, correct-latest-state,
linked-and-signed suffix checks, milestone verification with membership-union thresholds and
below-snapshot skips, and per-block structure checks reporting the first invalid index.

## Key design decisions

1. **Milestones XOR trailing signed blocks:** proofs carrying both are rejected — the suffix rides inside the last milestone on this path (flagged constraint pending engineer decision).
2. **First-invalid-index reporting** gives fraud-proof construction its objective citation ([`REQ-ENFPROOF-3-EEDR2Y`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-3-eedr2y)).

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

| Source file                                                                                           | Specification IDs                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateProofFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol) | [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b), [`REQ-ENFPROOF-1-RH4WEM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-1-rh4wem), [`REQ-ENFPROOF-3-EEDR2Y`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-3-eedr2y) |

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

| Requirement / invariant                                                                                         | Implementation status | Evidence                                                                              | Gap / divergence                                                                        |
| --------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`INV-ENFPROOF-1-DR1N9B`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1-dr1n9b) | Covered               | **Here:** view/pure family, caller-independent.                                       | Live console logging (dev artifact) is a deploy blocker noted in the architecture view. |
| [`REQ-ENFPROOF-3-EEDR2Y`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-3-eedr2y) | Covered               | **Here:** index-reporting structure checks.                                           | None.                                                                                   |
| [`REQ-ENFPROOF-1-RH4WEM`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-1-rh4wem) | Covered               | **Here:** the single verification implementations consumed by adoption/disputes/sync. | Milestone-XOR-suffix exclusivity pending engineer decision.                             |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation       | Public entry and setup                                                                 | Oracle and forbidden effects                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-proof-facet-1-jsb4sr"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR` | Proof predicates | Verify valid/manipulated proofs across anchors, hops, suffixes, and the XOR constraint | Valid proofs verify; each manipulation rejects with actionable detail; XOR behavior documented | <a id="unit-test-state-proof-facet-1-jsb4sr.p1"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P1` — valid milestone chain; <a id="unit-test-state-proof-facet-1-jsb4sr.p2"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P2` — membership-hop threshold met; <a id="unit-test-state-proof-facet-1-jsb4sr.p3"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P3` — suffix linkage break; <a id="unit-test-state-proof-facet-1-jsb4sr.p4"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P4` — first-invalid at first block; <a id="unit-test-state-proof-facet-1-jsb4sr.p5"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P5` — milestones+suffix (documents constraint); <a id="unit-test-state-proof-facet-1-jsb4sr.p6"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P6` — below-snapshot skips; <a id="unit-test-state-proof-facet-1-jsb4sr.p7"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P7` — membership-hop threshold missed; <a id="unit-test-state-proof-facet-1-jsb4sr.p8"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P8` — suffix signature break; <a id="unit-test-state-proof-facet-1-jsb4sr.p9"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P9` — first-invalid mid-chain; <a id="unit-test-state-proof-facet-1-jsb4sr.p10"></a>`UNIT-TEST-STATE-PROOF-FACET-1-JSB4SR.P10` — first-invalid at last block |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
