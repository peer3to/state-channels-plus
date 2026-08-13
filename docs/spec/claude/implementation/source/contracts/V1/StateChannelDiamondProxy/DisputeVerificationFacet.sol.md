# DisputeVerificationFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol) > **Status:** Authored — engineer verification pending.
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

The reduction engine: the pure fold (`reduce` — longest-valid-latest-block with hash tie-break,
slash union filtered to the union set, lowest-height timeout, self-removals, chain-derived inbound
tip), `reduceOutputToSnapshotData` (linkage verification, inbound application, slashes-suppress-
timeout precedence, exit emission), `reduceAndFinalize` (kill-period gate, commitment-exact set,
expectation match, idempotence), `challengeDisputeReduction` (currently unreachable from commit
paths), kill, output helpers, and the balance-invariant check.

## Key design decisions

1. **Immediate finalization by construction:** every commit path back-dates the reduction timestamp so the challenge period is pre-expired — gas traded for latency; the challenge entry point is dormant scaffolding for the optimistic design (spec-flagged open question).
2. **The empty-timeout fold divergence lives here:** a dispute without a timeout resets the candidate (height 0 beats real heights), the spec-flagged engineer decision.

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

| Source file                                                                                                                | Specification IDs                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DisputeVerificationFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol) | [`INV-ENFDIS-1`](../../../../../specification/enforcement/dispute-window.md#inv-enfdis-1), [`REQ-DIS-4`](../../../../../specification/disputes/disputes.md#req-dis-4), [`INV-DIS-7`](../../../../../specification/disputes/disputes.md#inv-dis-7), [`INV-DIS-8`](../../../../../specification/disputes/disputes.md#inv-dis-8) |

## Assumptions, dependencies, trust boundaries, and limits

- Executes only in the manager's delegatecall context (except UtilityFacet's plain calls).
- Deployment-size budget applies per deployable ([architecture view](../../../../views/architecture/contracts/architecture.md) §3 measurements).

## Specification adherence

- Operation semantics per the owning protocol documents; composition rules per [contracts.md](../../../../../specification/enforcement/contracts.md).

## Specification contradictions

See conformance rows.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                   | Implementation status | Evidence                                                                                          | Gap / divergence                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`INV-ENFDIS-1`](../../../../../specification/enforcement/dispute-window.md#inv-enfdis-1) | Covered               | **Here:** commitment-exact positional matching + on-chain recompute + challenge-only replacement. | Kill-order perturbation of the committed set feeds OQ-4 (order-independence unproven).                            |
| [`INV-DIS-7`](../../../../../specification/disputes/disputes.md#inv-dis-7)                | Covered               | **Here:** timeout applied only with an empty slash set.                                           | None.                                                                                                             |
| [`INV-DIS-8`](../../../../../specification/disputes/disputes.md#inv-dis-8)                | Contradicts           | **Here:** min-height fold.                                                                        | Empty-timeout struct (height 0) suppresses real timeouts — the spec-flagged divergence pending engineer decision. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation        | Public entry and setup                                                                   | Oracle and forbidden effects                                                                                    | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-dispute-verification-facet-1"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1` | Reduction algebra | Reduce permuted committed sets incl. kills, empty timeouts, tie-breaks, precedence cases | Deterministic per-field folds; precedence rules hold; divergences documented (empty-timeout, order permutation) | <a id="unit-test-dispute-verification-facet-1.p1"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P1` — latest-block tie-break; <a id="unit-test-dispute-verification-facet-1.p2"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P2` — slash union + filtering; <a id="unit-test-dispute-verification-facet-1.p3"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P3` — lowest-height timeout; <a id="unit-test-dispute-verification-facet-1.p4"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P4` — empty-timeout divergence (documents finding); <a id="unit-test-dispute-verification-facet-1.p5"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P5` — slashes-suppress-timeout; <a id="unit-test-dispute-verification-facet-1.p6"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P6` — order permutations (documents OQ-4); <a id="unit-test-dispute-verification-facet-1.p7"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P7` — idempotent finalize; <a id="unit-test-dispute-verification-facet-1.p8"></a>`UNIT-TEST-DISPUTE-VERIFICATION-FACET-1.P8` — exact-set matching |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
