# MessageBlockStorage.ts

> **Source:** [src/storage/MessageBlockStorage.ts](../../../../../../src/storage/MessageBlockStorage.ts)

## Requirements

- [`REQ-MSGSTORE-1-6ME9D7` (Content-addressed store with tip tracking)](../../../../specification/storage/message-blocks.md#req-msgstore-1-6me9d7)
- [`REQ-MSGSTORE-2-8RDXPZ` (Linked backward range reads)](../../../../specification/storage/message-blocks.md#req-msgstore-2-8rdxpz)
- [`INV-MSG-1-36Y41Q` (Each stream is one hash-linked chain per channel)](../../../../specification/settlement/cross-layer-messages.md#inv-msg-1-36y41q)

## UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1

Store and tip semantics

- Setup: Store extending, gap-skipping, equal-height, historical, duplicate, and justPersist blocks, and extending and non-extending verified runs into empty and populated stores, in both instances; read the tip against snapshots above and below it
- Oracle: Addressing exact; a duplicate keeps the first content; a direct store moves the tip by height, an equal height replaces it; justPersist and lower blocks leave it; a verified run moves it only on exact extension; a read from a tip above a gap reports the missing hash; `headNotBehind` never returns a head below the snapshot; instances isolated

- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P1` — tip advance on extension
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P2` — equal-height store replaces the tip
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P3` — justPersist leaves tip
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P4` — duplicate keeps the first content and is still a tip-moving store
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P5` — instance isolation
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P6` — higher block above a gap moves the tip; a read from the tip reports the missing hash
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P7` — lower block leaves the tip
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P8` — verified run extending the tip moves it to the run's last block
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P9` — verified run not extending the tip is persisted, tip unchanged
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P10` — verified run from the zero hash into an empty store moves the tip
- [x] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P11` — verified run with a nonzero predecessor into an empty store sets no tip
- [ ] `UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P12` — `headNotBehind` returns the snapshot head while the tip is absent or lower, the tip otherwise

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
