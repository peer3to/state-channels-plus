# StateSnapshot.test.ts

Test file: [test/models/StateSnapshot.test.ts](../../../../../../test/models/StateSnapshot.test.ts)
Exercises: [StateSnapshot.ts](../../../../implementation/source/src/models/StateSnapshot.ts.md)

## Overview

The suite drives the `StateSnapshot` model class directly — no protocol harness — on structs built
by the `stateSnapshot` factory in `test/factory`. Oracles assert that `StateSnapshot.from` and
`StateSnapshot.decode` reconstruct a struct deep-equal to the original, that `encode`/`decode`
round-trips preserve every field, and that `hash` and `snapshotDataHash` equal the keccak256 of
the corresponding `Codec` encodings. Property getters (`forkID`, `snapshotData`, inbound/outbound
message block hashes) are checked field-by-field against the source struct, and `isGenesis` is
verified in both directions by constructing a snapshot whose `forkId` equals its
`snapshotDataHash`. An immutability check confirms that mutating a struct returned by `toStruct`
does not affect the model's internal state. Out of scope: how snapshots are produced, stored, or
validated (SnapshotUpdateService, StateSnapshotStorage, and contract facet suites). No test IDs
are assignable here: the StateSnapshot implementation report defines no component test
obligations, and even after atomization each `REQ-DATA-1-1KNRQS` permutation is a malformed-input
rejection case, which this happy-path suite does not attempt; the snapshot-struct canonical-form
permutation (`INV-DATA-1-F8CG0P.T1.P10`) requires equal-value encode identity and decode equality in one
demonstration, which no single test here provides.

## Tests

- `should create StateSnapshot from StateSnapshotStruct`: none
- `should create StateSnapshot from encoded bytes`: none
- `should convert back to struct correctly`: none
- `should round-trip encode/decode correctly`: none
- `should compute hash correctly`: none
- `should compute snapshotDataHash correctly`: none
- `should have consistent hash for same data`: none
- `should return correct forkId`: none
- `should return correct snapshotData`: none
- `should return correct latestInboundMessageBlockHash`: none
- `should return correct latestOutboundMessageBlockHash`: none
- `should identify genesis snapshot correctly`: none
- `should identify non-genesis snapshot correctly`: none
- `should maintain data integrity through transformations`: none
- `should not allow modification of underlying data`: none
