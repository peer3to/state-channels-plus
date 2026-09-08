# StateSnapshotFacet.sol — Source Report

> **Source:** [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol) > **Status:** Authored — engineer verification pending.
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

Snapshot advancement: successor-fork adoption along expired reduced-result links (genesis shape +
derived timestamp) and same-fork advance by milestone proof (newer + all pending inbound
consumed); both prune processed outbound blocks, verify the linked range, process each message
(EXIT→withdraw, unsupported reverts), enforce withdrawals≤deposits, emit, and housekeep (zero-
participant close with the treasury TODO, storage clears).
The zero-participant close removes the channel ID from the enumerable open-channel set before it
deletes the snapshot, using the common idempotent swap-and-pop helper.

## Key design decisions

1. **Coupled adoption+outbound processing in one revertible operation** — a failing consumer withdrawal reverts the whole advance rather than splitting value from state ([`REQ-ENFSNAP-1-FYN3BW`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-1-fyn3bw)).
2. **The state-proof self-call is typed by the manager interface.** Verification of the incoming
   proof is reached on `address(this)` through
   [StateChannelManagerInterface](../../StateChannelManagerInterface.sol.md)
   ([#L122](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L122)) instead of the proxy contract type; the call itself is
   unchanged, and this facet no longer imports the proxy.
3. **Final close updates enumeration in the snapshot transaction.** Registry removal, snapshot
   deletion, balance cleanup, and `StateSnapshotUpdated` either commit together or all revert.

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

| Source file                                                                                                 | Specification IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [StateSnapshotFacet.sol](../../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol) | [`INV-ENFSNAP-1-9VZ2HE`](../../../../../specification/enforcement/snapshot-adoption.md#inv-enfsnap-1-9vz2he), [`REQ-ENFSNAP-1-FYN3BW`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-1-fyn3bw), [`REQ-ENFSNAP-2-MGRCY8`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-2-mgrcy8), [`REQ-ENFSNAP-3-VD9T8A`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a), [`REQ-LIF-8-2HDG3A`](../../../../../specification/settlement/lifecycle.md#req-lif-8-2hdg3a) |

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

| Requirement / invariant                                                                                      | Implementation status | Evidence                                                                                                    | Gap / divergence                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`INV-ENFSNAP-1-9VZ2HE`](../../../../../specification/enforcement/snapshot-adoption.md#inv-enfsnap-1-9vz2he) | Covered               | **Here:** the two paths' monotonicity/link checks.                                                          | None.                                                                                                |
| [`REQ-ENFSNAP-1-FYN3BW`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-1-fyn3bw) | Covered               | **Here:** prune-verify-process-cap in both paths.                                                           | Blocked-withdrawal handling (malicious consumer) remains the settlement open question.               |
| [`REQ-ENFSNAP-3-VD9T8A`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-3-vd9t8a) | Covered               | **Here:** pending-inbound-consumed requirement on same-fork advance.                                        | None.                                                                                                |
| [`REQ-ENFSNAP-2-MGRCY8`](../../../../../specification/enforcement/snapshot-adoption.md#req-enfsnap-2-mgrcy8) | Covered               | **Here:** prune-then-process over linked ranges makes any batch split converge to the same tips and totals. | Convergence is asserted by construction; the permutation test evidence is a verification obligation. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                                  | Obligation                        | Public entry and setup                                                                                                  | Oracle and forbidden effects                                                                                  | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-state-snapshot-facet-1-vjarbb"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB`                 | Advance paths                     | Advance same-fork/successor-fork with valid, split, overlapping, gapped ranges and failing withdrawals                  | At-most-once release; batch splits converge; regressions/contestable links revert; inbound gate holds         | <a id="unit-test-state-snapshot-facet-1-vjarbb.p1"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P1` — both paths valid; <a id="unit-test-state-snapshot-facet-1-vjarbb.p2"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P2` — batch-split convergence; <a id="unit-test-state-snapshot-facet-1-vjarbb.p3"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P3` — overlap pruned; <a id="unit-test-state-snapshot-facet-1-vjarbb.p4"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P4` — gap reverts; <a id="unit-test-state-snapshot-facet-1-vjarbb.p5"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P5` — withdrawal failure atomic; <a id="unit-test-state-snapshot-facet-1-vjarbb.p6"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P6` — cap boundary; <a id="unit-test-state-snapshot-facet-1-vjarbb.p7"></a>`UNIT-TEST-STATE-SNAPSHOT-FACET-1-VJARBB.P7` — pending-inbound gate |
| <a id="integration-test-open-channel-registry-1-a8m2kp"></a>`INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP` | Normal lifecycle registry removal | Open several channels through the SDK, close one through the ordinary participant lifecycle, and scan lifecycle events. | The closed ID leaves registry pages, live IDs remain, and the event-derived set equals the paged manager set. | <a id="integration-test-open-channel-registry-1-a8m2kp.p1"></a>`INTEGRATION-TEST-OPEN-CHANNEL-REGISTRY-1-A8M2KP.P1` — participant-lifecycle close and event/registry equality.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Related source reports

- [StateChannelManagerProxy](./StateChannelManagerProxy.sol.md), [StateChannelCommon](./StateChannelCommon.sol.md).
