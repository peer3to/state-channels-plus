# DisputeManagerFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol) > **Status:** Authored — engineer verification pending.
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

Dispute upload: disputer==sender + eligibility, auditing-data hash binding, timeout race checks,
per-address throttle + one-post-per-window, window creation/commitment/kill-refresh bookkeeping
with the fully-killed reopen, and the full-threshold immediate-finalization shortcut.

## Key design decisions

1. **Commitment recorded immediately at upload** — the kill period is the challenge window over committed disputes, matching the corrected lifecycle of the disputes spec.

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

| Source file                                                                                                      | Specification IDs                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DisputeManagerFacet.sol](../../../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol) | [`REQ-ENFDIS-1-8CSA6B`](../../../../../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b), [`REQ-ENFDIS-2-VV9FPR`](../../../../../specification/enforcement/dispute-window.md#req-enfdis-2-vv9fpr) |

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

| Requirement / invariant                                                                                 | Implementation status | Evidence                                                        | Gap / divergence |
| ------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- | ---------------- |
| [`REQ-ENFDIS-1-8CSA6B`](../../../../../specification/enforcement/dispute-window.md#req-enfdis-1-8csa6b) | Covered               | **Here:** the exact window transitions incl. reopen + shortcut. | None.            |
| [`REQ-ENFDIS-2-VV9FPR`](../../../../../specification/enforcement/dispute-window.md#req-enfdis-2-vv9fpr) | Covered               | **Here:** throttle + hasPosted bounds.                          | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                    | Obligation         | Public entry and setup                                                   | Oracle and forbidden effects                                                                          | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-dispute-manager-facet-1-b4kky2"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2` | Upload bookkeeping | Upload through every gate, boundary, reopen, and threshold-shortcut case | Transitions exactly per lifecycle; bounds hold; shortcut force-expires and commits the claimed output | <a id="unit-test-dispute-manager-facet-1-b4kky2.p1"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P1` — auditing-flag mismatch revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p2"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P2` — evidence accepted at period edge; <a id="unit-test-dispute-manager-facet-1-b4kky2.p3"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P3` — kill refresh; <a id="unit-test-dispute-manager-facet-1-b4kky2.p4"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P4` — fully-killed reopen; <a id="unit-test-dispute-manager-facet-1-b4kky2.p5"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P5` — threshold shortcut; <a id="unit-test-dispute-manager-facet-1-b4kky2.p6"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P6` — throttle boundary; <a id="unit-test-dispute-manager-facet-1-b4kky2.p7"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P7` — auditing-hash mismatch revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p8"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P8` — disputer-not-sender revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p9"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P9` — cannot-participate revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p10"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P10` — already-posted revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p11"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P11` — timeout calldata-posted race revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p12"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P12` — previous-producer calldata mismatch race revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p13"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P13` — timeout before min-timestamp race revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p14"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P14` — window-created-too-early race revert; <a id="unit-test-dispute-manager-facet-1-b4kky2.p15"></a>`UNIT-TEST-DISPUTE-MANAGER-FACET-1-B4KKY2.P15` — evidence rejected past period edge |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
