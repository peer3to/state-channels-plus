# MessageBlockStorage.ts

> **Source:** [src/storage/MessageBlockStorage.ts](../../../../../../src/storage/MessageBlockStorage.ts)
>
> **Design views:** [views/architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md), [views/architecture/sdk/dispute-pipeline.md](../../../views/architecture/sdk/dispute-pipeline.md)

## Requirements

- [`REQ-MSGSTORE-1-6ME9D7` (Content-addressed store with tip tracking)](../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7)
  Contradicts: Tip clause: `>=` lets an equal-height store repoint the tip (spec requires strictly newer). See [`FIND-STORAGE-2-NK2XBF`](../../../../audit/open-findings.md#find-storage-2-nk2xbf).
- [`REQ-MSGSTORE-2-8RDXPZ` (Linked backward range reads)](../../../../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz)
- [`INV-MSG-1-36Y41Q` (Each stream is one hash-linked chain per channel)](../../../../specification/settlement/cross-layer-messages.md#inv-msg-1-36y41q)

## UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1

Store and tip semantics

- Setup: Store extending, equal-height, historical, duplicate, and justPersist blocks in both instances
- Oracle: Addressing exact; duplicates idempotent; tip behavior documented incl. the equal-height divergence; instances isolated

- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P1` — tip advance on extension
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P2` — equal-height store (documents divergence)
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P3` — justPersist leaves tip
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P4` — duplicate idempotent
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P5` — instance isolation

## UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV

Range reads

- Setup: Read complete, gapped, unlinked, zero-boundary, and strict ranges
- Oracle: Complete ranges are exact; incomplete ranges identify the missing hash; strict reads reject them

- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P1` — complete range
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P2` — missing middle block
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P3` — bound at genesis
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P4` — unknown upper bound
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P5` — bound at tip
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P6` — equal bounds
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P7` — strict read rejects an incomplete range
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P8` — zero upper cannot satisfy a nonzero lower
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P9` — reaching zero before the requested lower is incomplete
