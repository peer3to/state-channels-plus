# keys.ts

> **Source:** [keys.ts](../../../../../../src/storage/keys.ts)

## Requirements

- [`INV-BLKSTORE-1-MK4W8D` (Index consistency)](../../../../specification/storage/blocks.md#inv-blkstore-1-mk4w8d)

## UNIT-TEST-KEYS-32-FMYDFT

Coordinate encoding

- Setup: Use real fork hashes and zero/positive heights; output equals the original colon-joined representation and separates coordinates.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-KEYS-32-FMYDFT.P1` — preserves zero-height coordinates
- [x] `UNIT-TEST-KEYS-32-FMYDFT.P2` — separates positive heights and fork identities

## UNIT-TEST-KEYS-33-YJ66W1

Evidence key encoding

- Setup: Use real hashes as a dispute hash, a finalized snapshot hash and one hash shared by both.
- Oracle: Audit keys equal `dispute:<disputeHash>`, sync keys equal `sync:<finalizedSnapshotHash>`, and only a sync key is recognised as one, also when both kinds carry the same hash.

- [x] `UNIT-TEST-KEYS-33-YJ66W1.P1` — audit evidence key is `dispute:<disputeHash>`
- [x] `UNIT-TEST-KEYS-33-YJ66W1.P2` — sync evidence key is `sync:<finalizedSnapshotHash>`
- [x] `UNIT-TEST-KEYS-33-YJ66W1.P3` — a sync key is told from an audit key of the same hash
