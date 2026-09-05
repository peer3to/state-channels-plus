# disputes.ts — Source Report

> **Source:** [src/types/disputes.ts](../../../../../../src/types/disputes.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

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

Client-side dispute-domain types (windows, verification records, reduction operations).

## Key design decisions

_None — the file is declarative/mechanical; behavior-shaping decisions live with its consumers._

## Inputs, outputs, state, and side effects

| Aspect       | Contents        |
| ------------ | --------------- |
| Inputs       | Per role above. |
| Outputs      | Per role above. |
| Owned state  | Per role above. |
| Side effects | Per role above. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                            | Specification IDs                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [disputes.ts](../../../../../../src/types/disputes.ts) | [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) |

Contribution in this file: [`REQ-DISPUTE-PIPE-9-TDWQPV`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv). The conformance rows below name this owner and the other required owners.

## Assumptions, dependencies, trust boundaries, and limits

- Network transports are untrusted byte pipes; identity comes only from the handshake.

## Specification adherence

- Declarative; consumers own behavior.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                                           | Implementation status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Gap / divergence |
| ----------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-DISPUTE-PIPE-9-TDWQPV`](../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-9-tdwqpv) | Covered               | **Here:** [source](../../../../../../src/types/disputes.ts#L45) keeps the SDK tuple in the same field order as the Solidity signed input. **Other files:** [DisputeManager.ts](../disputeManager/DisputeManager.ts.md) (dispute admission, rollback and construction), [EventSyncService.ts](../stateManager/eventSync/EventSyncService.ts.md) (authoritative timestamped slash recovery), [DisputeManagerFacet.sol](../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol.md) (conditional admission before mutation), [DisputeUtils.sol](../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol.md) (canonical reason validation), [DisputeValidationService.ts](../stateManager/dispute/DisputeValidationService.ts.md) (all remaining audit checks). | —                |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                | Obligation            | Public entry and setup                                                                         | Oracle and forbidden effects                                       | Required permutations                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-dispute-input-codec-1-cwjv98"></a>`UNIT-TEST-DISPUTE-INPUT-CODEC-1-CWJV98` | Signed input encoding | Encode and decode factory-built nested dispute confirmation; toggle the boolean after signing. | Both values round-trip and the signature binds the original value. | <a id="unit-test-dispute-input-codec-1-cwjv98.p1"></a>`UNIT-TEST-DISPUTE-INPUT-CODEC-1-CWJV98.P1` — signed nested encoding binds and round-trips the boolean |

## Related source reports

- [protocol-model/data-types](../../../../specification/protocol-model/data-types.md) (the neutral vocabulary).
