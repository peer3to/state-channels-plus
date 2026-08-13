# test/utils/Codec.test.ts — Test Report

> **Test file:** [test/utils/Codec.test.ts](../../../../../../../test/utils/Codec.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [Codec.ts](../../../../implementation/source/src/utils/Codec.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite calls `Codec.encode`/`Codec.decode` directly with factory-built domain structs and
asserts byte-level round trips: `decode(encode(T))` deep-equals the original for six `Type`
variants (Block, JoinChannel, SignedJoinChannel, JoinChannelConfirmation, Transaction, Dispute)
plus two `DisputeFraudProofType` proof encodings (DisputeBlockAuthorNotParticipant,
DisputeInvalidBlockStructure). The error-handling cases assert that an unmapped type value throws
`No ethers type mapping found` on encode and that decoding corrupt hex (`0xinvaliddata`) throws.
Out of scope: the other `Type` enum members (the enum has 21; six are round-tripped here),
explicit above-`Number.MAX_SAFE_INTEGER` boundary values, and caller-side handling of decode
failures (owned by the RPC layer per [`REQ-RPC-1-FF89Z0`](../../../../specification/peer-communication/rpc.md#req-rpc-1-ff89z0)). [`UNIT-TEST-CODEC-1-HFAA3B`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b) now defines one
round-trip permutation per `Type`; the six variants exercised here are assigned, while `.P2`
(above-safe-integer values) and the round trips for the fifteen untested `Type` members remain
without a test.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                  | Covers                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > should encode and decode BlockStruct correctly`](../../../../../../../test/utils/Codec.test.ts#L9) (line 9)                     | [`UNIT-TEST-CODEC-1-HFAA3B.P1`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p1)   |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > should encode and decode JoinChannelStruct correctly`](../../../../../../../test/utils/Codec.test.ts#L17) (line 17)             | [`UNIT-TEST-CODEC-1-HFAA3B.P5`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p5)   |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > should encode and decode SignedJoinChannelStruct correctly`](../../../../../../../test/utils/Codec.test.ts#L26) (line 26)       | [`UNIT-TEST-CODEC-1-HFAA3B.P6`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p6)   |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > should encode and decode JoinChannelConfirmationStruct correctly`](../../../../../../../test/utils/Codec.test.ts#L41) (line 41) | [`UNIT-TEST-CODEC-1-HFAA3B.P7`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p7)   |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > should encode and decode TransactionStruct correctly`](../../../../../../../test/utils/Codec.test.ts#L62) (line 62)             | [`UNIT-TEST-CODEC-1-HFAA3B.P10`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p10) |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > should encode and decode DisputeStruct correctly`](../../../../../../../test/utils/Codec.test.ts#L71) (line 71)                 | [`UNIT-TEST-CODEC-1-HFAA3B.P11`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p11) |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > round-trips DisputeBlockAuthorNotParticipant proof`](../../../../../../../test/utils/Codec.test.ts#L80) (line 80)               | —                                                                                                                      |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > round-trips DisputeInvalidBlockStructure proof`](../../../../../../../test/utils/Codec.test.ts#L99) (line 99)                   | —                                                                                                                      |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > Error handling > should throw error for invalid type in encode`](../../../../../../../test/utils/Codec.test.ts#L116) (line 116) | —                                                                                                                      |
| [`Codec > Round-trip encoding/decoding: decode(encode(T)) === T > Error handling > should throw error for invalid encoded data`](../../../../../../../test/utils/Codec.test.ts#L122) (line 122)   | [`UNIT-TEST-CODEC-1-HFAA3B.P3`](../../../../implementation/source/src/utils/Codec.ts.md#unit-test-codec-1-hfaa3b.p3)   |
