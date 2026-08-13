# FraudProofFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol) > **Status:** Authored — engineer verification pending.
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

Block fraud-proof application: per-proof skip-if-slashed, type dispatch (double-sign, invalid
transition via full replay incl. message-block recomputation, wrong genesis, invalid timestamp
with calldata/forfeit rules, forged inbound block), offender-must-match-declared, failed-or-
mismatched proofs slash the eligible submitter, successful slashes append with events.

## Key design decisions

1. **Self-slash symmetry at the boundary:** submission is staked, making the mirror-preflight pattern load-bearing for honest clients.

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

| Source file                                                                                              | Specification IDs                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FraudProofFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol) | [`INV-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1), [`REQ-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1), [`REQ-ENFFP-2`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).

## Specification contradictions

None demonstrated.

## Missing behavior

See conformance rows.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                 | Implementation status | Evidence                                | Gap / divergence                                                                           |
| --------------------------------------------------------------------------------------- | --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`REQ-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-1) | Covered               | **Here:** the submitter-slash branches. | Ineligible-submitter penalty remains the open protocol question (implemented as no-slash). |
| [`REQ-ENFFP-2`](../../../../../specification/enforcement/fraud-slashing.md#req-enffp-2) | Covered               | **Here:** strict type dispatch.         | None.                                                                                      |
| [`INV-ENFFP-1`](../../../../../specification/enforcement/fraud-slashing.md#inv-enffp-1) | Covered               | **Here:** append + skip-if-slashed.     | None.                                                                                      |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                              | Obligation        | Public entry and setup                                                                                           | Oracle and forbidden effects                                                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-fraud-proof-facet-1"></a>`UNIT-TEST-FRAUD-PROOF-FACET-1` | Proof application | Apply each type valid/invalid/mismatched from eligible and ineligible submitters, incl. replay-heavy transitions | Valid slashes offender once; invalid/mismatch slashes eligible submitter; replay matches client-side execution | <a id="unit-test-fraud-proof-facet-1.p1"></a>`UNIT-TEST-FRAUD-PROOF-FACET-1.P1` — each type valid; <a id="unit-test-fraud-proof-facet-1.p2"></a>`UNIT-TEST-FRAUD-PROOF-FACET-1.P2` — each type invalid→self-slash; <a id="unit-test-fraud-proof-facet-1.p3"></a>`UNIT-TEST-FRAUD-PROOF-FACET-1.P3` — offender mismatch; <a id="unit-test-fraud-proof-facet-1.p4"></a>`UNIT-TEST-FRAUD-PROOF-FACET-1.P4` — skip-if-slashed; <a id="unit-test-fraud-proof-facet-1.p5"></a>`UNIT-TEST-FRAUD-PROOF-FACET-1.P5` — replay parity with mirror |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
