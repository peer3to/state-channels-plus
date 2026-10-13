# JoinChannelBlockStorage.test.ts

Test file: [test/storage/JoinChannelBlockStorage.test.ts](../../../../../../test/storage/JoinChannelBlockStorage.test.ts)
Exercises: [MessageBlockStorage.ts](../../../../implementation/source/src/storage/MessageBlockStorage.ts.md)

## Overview

The suite exercises `MessageBlockStorage` as the inbound instance with hand-built hash-linked
message blocks. Its range cases cover a complete walk, a missing middle block, an unknown upper
hash, the zero/zero empty anchor, zero upper with a nonzero lower, a linked suffix that reaches
zero before its requested lower boundary, and the strict all-or-nothing rejection. Each tolerant
incomplete case asserts both the proven suffix and `missingBlockHash`. Store tests cover computed
and supplied hashes and duplicate insertion. Tip tests use a factory-built linked chain and cover a
height move above a gap with a read from that tip, equal-height replacement, `justPersist`,
verified-run extension into populated and empty stores (including a held predecessor that is not the tip), and a lower block leaving the tip.

## Tests

- `stores block with computed hash`: none
- `respects provided hash override`: none
- `ignores metadata on duplicate store`: none
- `returns undefined for unknown hashes`: none
- `retrieves ordered entries in range`: none
- `complete range → blocks oldest-first, no missingBlockHash`: REQ-MSGSTORE-2-8RDXPZ.T1.P1, REQ-MSGSTORE-2-8RDXPZ.T1.P3, REQ-MSGSTORE-2-8RDXPZ.T1.P5, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P1, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P3, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P5
- `gap mid-range → blocks stop at the gap, missingBlockHash is the unheld hash`: REQ-MSGSTORE-2-8RDXPZ.T1.P2, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P2
- `unheld upperBlockHash → empty blocks, missingBlockHash is it`: REQ-MSGSTORE-2-8RDXPZ.T1.P4, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P4
- `upperBlockHash = ZeroHash → empty run, no gap (honest pre-genesis anchor)`: none
- `zero upper bound cannot satisfy a nonzero lower bound`: REQ-MSGSTORE-2-8RDXPZ.T1.P8, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P8
- `a walk that reaches zero before the nonzero lower bound is incomplete`: REQ-MSGSTORE-2-8RDXPZ.T1.P9, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P9
- `empty store → empty run, no gap`: none
- `the strict read still throws the same message on that gap`: REQ-MSGSTORE-2-8RDXPZ.T1.P7, UNIT-TEST-MESSAGE-BLOCK-STORAGE-2-9NC6VV.P7
- `returns undefined when storage is empty`: none
- `a higher block above an unheld gap moves the tip, and a read from that tip reports the missing block`: REQ-MSGSTORE-1-6ME9D7.T1.P8, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P6
- `an equal-height block replaces the tip`: REQ-MSGSTORE-1-6ME9D7.T1.P9, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P2
- `a justPersist store of a higher block leaves the tip`: REQ-MSGSTORE-1-6ME9D7.T1.P5, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P3
- `a verified run that extends the tip moves the tip to its last block`: REQ-MSGSTORE-1-6ME9D7.T1.P10, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P8
- `a verified run that does not extend the tip is persisted and leaves the tip`: REQ-MSGSTORE-1-6ME9D7.T1.P11, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P9
- `a verified run whose predecessor is held but is not the tip is persisted and leaves the tip`: REQ-MSGSTORE-1-6ME9D7.T1.P15, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P13
- `a verified run from the zero hash into an empty store moves the tip to its last block`: REQ-MSGSTORE-1-6ME9D7.T1.P12, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P10
- `a verified run with a nonzero predecessor into an empty store is persisted and sets no tip`: REQ-MSGSTORE-1-6ME9D7.T1.P13, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P11
- `tracks the highest block height even when stored out of order`: REQ-MSGSTORE-1-6ME9D7.T1.P2, UNIT-TEST-MESSAGE-BLOCK-STORAGE-1-EHBRD1.P7
