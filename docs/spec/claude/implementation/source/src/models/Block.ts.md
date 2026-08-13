# Block.ts — Source Report

> **Source:** [src/models/Block.ts](../../../../../../../src/models/Block.ts) > **Status:** Authored — engineer verification pending.
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

The Block domain model: decode/encode against the canonical struct, identity hash, coordinates,
signature-set expansion (dedup by recovered signer), `didEveryoneSign`, relevant-timestamp logic
(author-signed vs posted), and equality.

## Key design decisions

1. **Signature expansion dedups by recovered signer**, so encoding malleability cannot double-count ([`REQ-ID-1`](../../../../specification/protocol-model/identity.md#req-id-1) malleability rule).
2. **Relevant timestamp encodes the forfeit rule's data side:** the author-signed predecessor uses block time; a posted one the on-chain time.

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

| Source file                                          | Specification IDs                                                                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Block.ts](../../../../../../../src/models/Block.ts) | [`REQ-DATA-1`](../../../../specification/protocol-model/data-types.md#req-data-1), [`REQ-ID-1`](../../../../specification/protocol-model/identity.md#req-id-1) |

## Assumptions, dependencies, trust boundaries, and limits

- Operates inside the participant runtime; untrusted input arrives only through the documented ingress paths.

## Specification adherence

- Canonical encoding round-trips; identity = hash of canonical encoding.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                     | Implementation status | Evidence                                   | Gap / divergence |
| --------------------------------------------------------------------------- | --------------------- | ------------------------------------------ | ---------------- |
| [`REQ-ID-1`](../../../../specification/protocol-model/identity.md#req-id-1) | Covered               | **Here:** recovery-deduped signature sets. | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                  | Obligation      | Public entry and setup                                                                  | Oracle and forbidden effects                                                   | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-model-1"></a>`UNIT-TEST-BLOCK-MODEL-1` | Model semantics | Round-trip, expand with dup/malleated signatures, compute relevant timestamps both ways | Byte-exact round trips; dedup by signer; timestamp selection per posting state | <a id="unit-test-block-model-1.p1"></a>`UNIT-TEST-BLOCK-MODEL-1.P1` — round trip; <a id="unit-test-block-model-1.p2"></a>`UNIT-TEST-BLOCK-MODEL-1.P2` — duplicate-signature dedup; <a id="unit-test-block-model-1.p3"></a>`UNIT-TEST-BLOCK-MODEL-1.P3` — didEveryoneSign unions; <a id="unit-test-block-model-1.p4"></a>`UNIT-TEST-BLOCK-MODEL-1.P4` — author-signed relevant timestamp; <a id="unit-test-block-model-1.p5"></a>`UNIT-TEST-BLOCK-MODEL-1.P5` — malleated-signature dedup; <a id="unit-test-block-model-1.p6"></a>`UNIT-TEST-BLOCK-MODEL-1.P6` — posted relevant timestamp |

## Related source reports

- [BlockStorage](../storage/BlockStorage.ts.md), [ValidationService](../stateManager/ValidationService.ts.md).
