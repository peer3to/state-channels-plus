# SignatureCollectionMap.ts — Source Report

> **Source:** [src/utils/SignatureCollectionMap.ts](../../../../../../src/utils/SignatureCollectionMap.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

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

Signer-keyed signature collection (dedup by recovered address) used in confirmation handling.

## Key design decisions

values, entries and forEach share projection from each participant map. Returned arrays stay fresh and outer-map iteration remains live during callbacks. See [SignatureCollectionMap.ts](../../../../../../src/utils/SignatureCollectionMap.ts#L117).

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

| Source file                                                                        | Specification IDs                                                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [SignatureCollectionMap.ts](../../../../../../src/utils/SignatureCollectionMap.ts) | [`REQ-ID-1-3Q2KB9`](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Role-consistent with the owning views.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant | Implementation status | Evidence | Gap / divergence |
| ----------------------- | --------------------- | -------- | ---------------- |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                                            | Obligation           | Public entry and setup                                                                                                | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-signature-collection-map-32-kb4qyc"></a>`UNIT-TEST-SIGNATURE-COLLECTION-MAP-32-KB4QYC` | Signature projection | Use real signed values across multiple keys; compare fresh ordered arrays and live iteration after callback mutation. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-signature-collection-map-32-kb4qyc.p1"></a>`UNIT-TEST-SIGNATURE-COLLECTION-MAP-32-KB4QYC.P1` — projects ordered signatures into fresh arrays and preserves live callback iteration |

## Related source reports

- Consumers per the views.
