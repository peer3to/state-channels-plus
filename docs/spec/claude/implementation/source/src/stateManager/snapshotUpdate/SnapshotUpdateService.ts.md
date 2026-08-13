# SnapshotUpdateService.ts — Source Report

> **Source:** [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/dispute-pipeline.md](../../../../views/architecture/sdk/dispute-pipeline.md)

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

Snapshot advancement: walks the on-chain snapshot's fork through expired reduced-result links to
the first undisputed fork, builds the successor-fork update with the unprocessed outbound range,
chains a same-fork milestone update for newer finalized state, and multicalls both — also the
N/N exit path.

## Key design decisions

1. **Multi-generation walking in one submission** — several dispute generations cross in one update because each link is verified on-chain anyway ([`REQ-DIS-9`](../../../../../specification/disputes/disputes.md#req-dis-9)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                 |
| ------------ | ---------------------------------------- |
| Inputs       | Advance triggers.                        |
| Outputs      | Update transactions with proof material. |
| Owned state  | None.                                    |
| Side effects | Chain submissions.                       |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                                                  | Specification IDs                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SnapshotUpdateService.ts](../../../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts) | [`REQ-DIS-9`](../../../../../specification/disputes/disputes.md#req-dis-9), [`REQ-MSG-5`](../../../../../specification/settlement/cross-layer-messages.md#req-msg-5) |

## Assumptions, dependencies, trust boundaries, and limits

- Ranges built from local stores must match on-chain verification exactly — divergence reverts harmlessly.

## Specification adherence

- Advance-only-along-uncontestable-links with incremental outbound processing ([`REQ-DIS-9`](../../../../../specification/disputes/disputes.md#req-dis-9), [`REQ-MSG-5`](../../../../../specification/settlement/cross-layer-messages.md#req-msg-5)).

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                    | Implementation status | Evidence                                                                                                                                                               | Gap / divergence |
| -------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DIS-9`](../../../../../specification/disputes/disputes.md#req-dis-9) | Covered               | **Here:** the link walk + range assembly. **Other files:** verification on-chain ([snapshot-adoption](../../../../../specification/enforcement/snapshot-adoption.md)). | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                          | Obligation        | Public entry and setup                                                        | Oracle and forbidden effects                                                                         | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-snapshot-update-service-1"></a>`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1` | Walk and assembly | Advance across zero/one/multiple generations with partial outbound processing | Correct link chains and ranges; same-fork chaining when newer finality exists; idempotent re-advance | <a id="unit-test-snapshot-update-service-1.p1"></a>`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1.P1` — multi-generation walk; <a id="unit-test-snapshot-update-service-1.p2"></a>`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1.P2` — range boundary at processed tip; <a id="unit-test-snapshot-update-service-1.p3"></a>`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1.P3` — same-fork chain; <a id="unit-test-snapshot-update-service-1.p4"></a>`UNIT-TEST-SNAPSHOT-UPDATE-SERVICE-1.P4` — already-current no-op |

## Related source reports

- [ReductionExecutor](../reduction/ReductionExecutor.ts.md), [MessageBlockStorage](../../storage/MessageBlockStorage.ts.md), [AgreementManager](../../agreementManager/AgreementManager.ts.md).
