# test/models/StateSnapshot.test.ts — Test Report

> **Test file:** [test/models/StateSnapshot.test.ts](../../../../../../test/models/StateSnapshot.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateSnapshot.ts](../../../../implementation/source/src/models/StateSnapshot.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

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
obligations, and even after atomization each [`REQ-DATA-1-1KNRQS`](../../../../specification/protocol-model/data-types.md#req-data-1-1knrqs) permutation is a malformed-input
rejection case, which this happy-path suite does not attempt; the snapshot-struct canonical-form
permutation ([`INV-DATA-1-F8CG0P.T1.P10`](../../../../specification/protocol-model/data-types.md#inv-data-1-f8cg0p.t1.p10)) requires equal-value encode identity and decode equality in one
demonstration, which no single test here provides.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                           | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`StateSnapshot Model > Static factory methods > should create StateSnapshot from StateSnapshotStruct`](../../../../../../test/models/StateSnapshot.test.ts#L27) (line 27) | —      |
| [`StateSnapshot Model > Static factory methods > should create StateSnapshot from encoded bytes`](../../../../../../test/models/StateSnapshot.test.ts#L33) (line 33)       | —      |
| [`StateSnapshot Model > Serialization > should convert back to struct correctly`](../../../../../../test/models/StateSnapshot.test.ts#L45) (line 45)                       | —      |
| [`StateSnapshot Model > Serialization > should round-trip encode/decode correctly`](../../../../../../test/models/StateSnapshot.test.ts#L50) (line 50)                     | —      |
| [`StateSnapshot Model > Hash computation > should compute hash correctly`](../../../../../../test/models/StateSnapshot.test.ts#L58) (line 58)                              | —      |
| [`StateSnapshot Model > Hash computation > should compute snapshotDataHash correctly`](../../../../../../test/models/StateSnapshot.test.ts#L64) (line 64)                  | —      |
| [`StateSnapshot Model > Hash computation > should have consistent hash for same data`](../../../../../../test/models/StateSnapshot.test.ts#L72) (line 72)                  | —      |
| [`StateSnapshot Model > Property getters > should return correct forkId`](../../../../../../test/models/StateSnapshot.test.ts#L80) (line 80)                               | —      |
| [`StateSnapshot Model > Property getters > should return correct snapshotData`](../../../../../../test/models/StateSnapshot.test.ts#L84) (line 84)                         | —      |
| [`StateSnapshot Model > Property getters > should return correct latestInboundMessageBlockHash`](../../../../../../test/models/StateSnapshot.test.ts#L90) (line 90)        | —      |
| [`StateSnapshot Model > Property getters > should return correct latestOutboundMessageBlockHash`](../../../../../../test/models/StateSnapshot.test.ts#L98) (line 98)       | —      |
| [`StateSnapshot Model > Genesis snapshot logic > should identify genesis snapshot correctly`](../../../../../../test/models/StateSnapshot.test.ts#L108) (line 108)         | —      |
| [`StateSnapshot Model > Genesis snapshot logic > should identify non-genesis snapshot correctly`](../../../../../../test/models/StateSnapshot.test.ts#L115) (line 115)     | —      |
| [`StateSnapshot Model > Data integrity > should maintain data integrity through transformations`](../../../../../../test/models/StateSnapshot.test.ts#L124) (line 124)     | —      |
| [`StateSnapshot Model > Immutability > should not allow modification of underlying data`](../../../../../../test/models/StateSnapshot.test.ts#L135) (line 135)             | —      |
