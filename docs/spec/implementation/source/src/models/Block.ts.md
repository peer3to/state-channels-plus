# Block.ts — Source Report

> **Source:** [src/models/Block.ts](../../../../../../src/models/Block.ts) > **Status:** Authored — engineer verification pending.
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

Constructors, author signing, expansion and removal share SignatureUtils byte normalization. Equivalent hex casing and byte arrays use the same stored bytes and recovery-cache key. Actual v bytes, compact values and malformed envelopes are preserved for validation. mergeFrom retains the first author envelope and the established defined-timestamp semantics; the queue delegates those rules here. See [normalizeSignature](../../../../../../src/models/Block.ts#L49).

Same-block copy merging belongs to Block: expand confirmation signatures, then copy a defined on-chain timestamp, including zero. Callers remain responsible for block identity and trust policy. See [Block.ts](../../../../../../src/models/Block.ts#L253).

1. **Signature expansion dedups by recovered signer**, so encoding malleability cannot double-count ([`REQ-ID-1-3Q2KB9` (Recoverable signatures over canonical targets)](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9) malleability rule).
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

| Source file                                       | Specification IDs                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Block.ts](../../../../../../src/models/Block.ts) | [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs), [`REQ-ID-1-3Q2KB9`](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9), [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq) |

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

| Requirement / invariant                                                                   | Implementation status | Evidence                                                                                                                                                                                                                                     | Gap / divergence                                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`REQ-ID-1-3Q2KB9`](../../../../specification/protocol-model/identity.md#req-id-1-3q2kb9) | Covered               | **Here:** recovery-deduped signature sets.                                                                                                                                                                                                   | None.                                                                                                |
| [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq)   | Covered               | **Here:** [normalizeSignature](../../../../../../src/models/Block.ts#L49) implements the contribution described above. **Other files:** [SignatureUtils.ts](../utils/SignatureUtils.ts.md), [QueueStorage.ts](../storage/QueueStorage.ts.md) | Limited to this file's contribution; cache freshness and aggregate queue limits remain as specified. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation            | Public entry and setup                                                                                                                | Oracle and forbidden effects                                                                                 | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-block-model-1-037dm6"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6`             | Model semantics       | Round-trip, expand with dup/malleated signatures, compute relevant timestamps both ways                                               | Byte-exact round trips; dedup by signer; timestamp selection per posting state                               | <a id="unit-test-block-model-1-037dm6.p1"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P1` — round trip; <a id="unit-test-block-model-1-037dm6.p2"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P2` — duplicate-signature dedup; <a id="unit-test-block-model-1-037dm6.p3"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P3` — didEveryoneSign unions; <a id="unit-test-block-model-1-037dm6.p4"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P4` — author-signed relevant timestamp; <a id="unit-test-block-model-1-037dm6.p5"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P5` — malleated-signature dedup; <a id="unit-test-block-model-1-037dm6.p6"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P6` — posted relevant timestamp; <a id="unit-test-block-model-1-037dm6.p7"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P7` — equivalent byte representations share one recovery-cache entry; <a id="unit-test-block-model-1-037dm6.p8"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P8` — merge uses canonical equality and keeps its original author envelope; <a id="unit-test-block-model-1-037dm6.p9"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P9` — struct construction and author re-signing normalize real signer output; <a id="unit-test-block-model-1-037dm6.p10"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P10` — constructors deduplicate hex casing and byte-array confirmations; <a id="unit-test-block-model-1-037dm6.p11"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P11` — expansion and removal use the same byte equality; <a id="unit-test-block-model-1-037dm6.p12"></a>`UNIT-TEST-BLOCK-MODEL-1-037DM6.P12` — keeps malformed envelopes unchanged for authentication failure |
| <a id="unit-test-block-copy-merge-32-8jddqr"></a>`UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR` | Same-block copy merge | Merge factory-built copies through Block.mergeFrom and inspect the confirmation signature set and defined/undefined timestamp policy. | Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy. | <a id="unit-test-block-copy-merge-32-8jddqr.p1"></a>`UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P1` — mergeFrom preserves a defined timestamp when the incoming copy has none; <a id="unit-test-block-copy-merge-32-8jddqr.p2"></a>`UNIT-TEST-BLOCK-COPY-MERGE-32-8JDDQR.P2` — mergeFrom accepts a zero timestamp from the incoming copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Related source reports

- [BlockStorage](../storage/BlockStorage.ts.md), [ValidationService](../stateManager/ingest/ValidationService.ts.md).
