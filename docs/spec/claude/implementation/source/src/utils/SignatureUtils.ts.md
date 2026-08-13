# SignatureUtils.ts — Source Report

> **Source:** [src/utils/SignatureUtils.ts](../../../../../../../src/utils/SignatureUtils.ts) > **Status:** Authored — engineer verification pending.
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

Protocol signing/recovery helpers: sign/recover over canonical encodings (blocks, joins, opens,
disputes) via EIP-191 over the keccak of encoded bytes; address recovery and comparison.

## Key design decisions

1. **Sign-the-hash-of-canonical-bytes everywhere** — one signing form for protocol objects (the [`REQ-ID-1`](../../../../specification/protocol-model/identity.md#req-id-1) target rule; domain separation remains [OQ-29](../../../../specification/open-questions.md)).

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

| Source file                                                           | Specification IDs                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SignatureUtils.ts](../../../../../../../src/utils/SignatureUtils.ts) | [`REQ-ID-1`](../../../../specification/protocol-model/identity.md#req-id-1), [`REQ-ID-2`](../../../../specification/protocol-model/identity.md#req-id-2) |

## Assumptions, dependencies, trust boundaries, and limits

- Utility semantics must hold identically on both supported hosts.

## Specification adherence

- Recovery-based verification; normalized comparison.

## Specification contradictions

None demonstrated.

## Missing behavior

No object-type/chain/deployment domain tags (the OQ-29 decision surface).

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                     | Implementation status | Evidence                                                                                                                                   | Gap / divergence                                |
| --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [`REQ-ID-1`](../../../../specification/protocol-model/identity.md#req-id-1) | Covered               | **Here:** canonical-target signing + recovery.                                                                                             | Domain separation pending OQ-29 (spec-tracked). |
| [`INV-ID-1`](../../../../specification/protocol-model/identity.md#inv-id-1) | Covered               | **Here:** recovery over canonical encodings decides identity for every protocol object; no rule distinguishes participant from key holder. | None.                                           |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                          | Obligation   | Public entry and setup                            | Oracle and forbidden effects                                                         | Required permutations                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <a id="unit-test-signature-utils-1"></a>`UNIT-TEST-SIGNATURE-UTILS-1` | Sign/recover | Sign each object class; recover; tamper; malleate | Recovery matches signer; tampering breaks; malleation never yields a second identity | <a id="unit-test-signature-utils-1.p1"></a>`UNIT-TEST-SIGNATURE-UTILS-1.P1` — each class round trip; <a id="unit-test-signature-utils-1.p2"></a>`UNIT-TEST-SIGNATURE-UTILS-1.P2` — tamper detection; <a id="unit-test-signature-utils-1.p3"></a>`UNIT-TEST-SIGNATURE-UTILS-1.P3` — malleation behavior |

## Related source reports

- [identity.md](../../../../specification/protocol-model/identity.md), [Block](../models/Block.ts.md).
