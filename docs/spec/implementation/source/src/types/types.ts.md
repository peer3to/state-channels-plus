# types.ts — Source Report

> **Source:** [src/types/types.ts](../../../../../../src/types/types.ts) > **Status:** Authored — engineer verification pending.
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

Core aliases (Address, Hash, ChannelId, ForkId, BlockHeight…) shared across the SDK.

## Key design decisions

`HpAddress` names a lowercase Hyperswarm public key and `PeerKey` is the union of `Address` and `HpAddress`: the key a peer is counted by before and after identity proof ([ProfileManager](../ProfileManager.ts.md)). ChecksumAddress names normalized address keys. It is a string alias; normalization is performed by getChecksumAddress, not by a runtime type check. See [types.ts](../../../../../../src/types/types.ts#L10).

Address and Signature are the source map key and value types; ChecksumAddress names normalized eligibility-cache identities. These aliases do not perform runtime validation. QueueStorage only enforces contribution counts. See [Address](../../../../../../src/types/types.ts#L9).

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

| Source file                                      | Specification IDs                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [types.ts](../../../../../../src/types/types.ts) | [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs), [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq) |

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

| Requirement / invariant                                                                 | Implementation status | Evidence                                                                                                                                                                                                                        | Gap / divergence                                                                                     |
| --------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`REQ-QSTORE-2-VYWJAQ`](../../../../specification/storage/queue.md#req-qstore-2-vywjaq) | Covered               | **Here:** [Address](../../../../../../src/types/types.ts#L9) implements the contribution described above. **Other files:** [SignatureUtils.ts](../utils/SignatureUtils.ts.md), [QueueStorage.ts](../storage/QueueStorage.ts.md) | Limited to this file's contribution; cache freshness and aggregate queue limits remain as specified. |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID | Obligation | Public entry and setup | Oracle and forbidden effects | Required permutations |
| ------------ | ---------- | ---------------------- | ---------------------------- | --------------------- |

## Related source reports

- [protocol-model/data-types](../../../../specification/protocol-model/data-types.md) (the neutral vocabulary).
