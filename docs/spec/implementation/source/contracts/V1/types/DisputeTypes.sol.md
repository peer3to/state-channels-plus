# DisputeTypes.sol — Source Report

> **Source:** [contracts/V1/types/DisputeTypes.sol](../../../../../../../contracts/V1/types/DisputeTypes.sol) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/contracts/manager-and-facets.md](../../../../views/architecture/contracts/manager-and-facets.md)

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

Dispute-side structs: DisputeInput/Dispute/SignedDispute/Confirmation, windows, auditing data,
ReduceOutput, Timeout.

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents              |
| ------------ | --------------------- |
| Inputs       | Per role above.       |
| Outputs      | Types/helpers/events. |
| Owned state  | None.                 |
| Side effects | None.                 |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                                  | Specification IDs                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [DisputeTypes.sol](../../../../../../../contracts/V1/types/DisputeTypes.sol) | [`REQ-DATA-1-1KNRQS`](../../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

Contribution in this file: [`REQ-DISPUTE-PIPE-9-TDWQPV`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv). The conformance rows below name this owner and the other required owners.

## Assumptions, dependencies, trust boundaries, and limits

- Declarative/support code; behavior owned by consumers.

## Specification adherence

- Consistent with the owning documents' type/behavior contracts.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                              | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gap / divergence |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-9-TDWQPV`](../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv) | Covered               | **Here:** [source](../../../../../../../contracts/V1/types/DisputeTypes.sol#L58) defines the signed boolean in DisputeInput. **Other files:** [DisputeManager.ts](../../../src/disputeManager/DisputeManager.ts.md) (dispute admission, rollback and construction), [EventSyncService.ts](../../../src/stateManager/eventSync/EventSyncService.ts.md) (authoritative timestamped slash recovery), [DisputeManagerFacet.sol](../StateChannelDiamondProxy/DisputeManagerFacet.sol.md) (conditional admission before mutation), [DisputeUtils.sol](../StateChannelDiamondProxy/utils/DisputeUtils.sol.md) (canonical reason validation), [DisputeValidationService.ts](../../../src/stateManager/dispute/DisputeValidationService.ts.md) (all remaining audit checks). | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- Consumers per the manager and state-machine-base views.
