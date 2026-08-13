# UtilityFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol) > **Status:** Authored — engineer verification pending.
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

Stateless helpers reached by plain CALL: unanimous threshold verification with per-signer dedup,
signer recovery, block decode/tryDecode, array operations, genesis-shape and snapshot-ordering
predicates.

## Key design decisions

1. **Called, not delegatecalled** — pure helpers need no storage context, shaving delegate overhead and keeping them trivially auditable.

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                             |
| ------------ | ---------------------------------------------------- |
| Inputs       | Per file role.                                       |
| Outputs      | State mutations/verdicts/events per operation group. |
| Owned state  | None declared (shared layout via inheritance).       |
| Side effects | Events; escrow via consumer where applicable.        |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                        | Specification IDs                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UtilityFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol) | [`REQ-ENFPROOF-2`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2), [`INV-ENFPROOF-1`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1) |

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

| Requirement / invariant                                                                           | Implementation status | Evidence                                                 | Gap / divergence |
| ------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- | ---------------- |
| [`REQ-ENFPROOF-2`](../../../../../specification/enforcement/proof-verification.md#req-enfproof-2) | Covered               | **Here:** deduplicated exact-set threshold verification. | None.            |
| [`INV-ENFPROOF-1`](../../../../../specification/enforcement/proof-verification.md#inv-enfproof-1) | Covered               | **Here:** stateless-by-construction.                     | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                      | Obligation                     | Public entry and setup                                                                                            | Oracle and forbidden effects                                                       | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-utility-facet-1"></a>`UNIT-TEST-UTILITY-FACET-1` | Threshold and shape predicates | Verify thresholds with dup/malleated/missing signers; decode valid/invalid blocks; shape predicates at boundaries | Dedup counting exact; malleability never double-counts; decode failures classified | <a id="unit-test-utility-facet-1.p1"></a>`UNIT-TEST-UTILITY-FACET-1.P1` — dup signer once; <a id="unit-test-utility-facet-1.p2"></a>`UNIT-TEST-UTILITY-FACET-1.P2` — malleated signature; <a id="unit-test-utility-facet-1.p3"></a>`UNIT-TEST-UTILITY-FACET-1.P3` — missing/extra member; <a id="unit-test-utility-facet-1.p4"></a>`UNIT-TEST-UTILITY-FACET-1.P4` — tryDecode paths; <a id="unit-test-utility-facet-1.p5"></a>`UNIT-TEST-UTILITY-FACET-1.P5` — genesis/ordering predicates |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
