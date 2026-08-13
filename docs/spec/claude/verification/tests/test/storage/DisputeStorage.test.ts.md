# test/storage/DisputeStorage.test.ts — Test Report

> **Test file:** [test/storage/DisputeStorage.test.ts](../../../../../../../test/storage/DisputeStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [DisputeStorage.ts](../../../../implementation/source/src/storage/DisputeStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite drives `DisputeStorage` directly with factory-built signed disputes: `storeDispute`
and `storeDisputeConfirmation` under computed and caller-provided hashes, `getDisputeConfirmation`
reads, signature-set merging with deduplication across repeated stores, preservation of the
original signed dispute when a different one arrives under the same hash, and behavior with
empty and large signature arrays plus several independent disputes side by side. The oracles
assert the returned hash, the stored signed dispute's identity, and the exact merged signature
sets. The per-fork disputed/own-dispute flags are not exercised anywhere in this file, and no
test permutes merge order, re-delivers an identical complete confirmation, or decodes the stored
dispute, so those permutations stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                | Covers                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DisputeStorage > CREATE - storeDispute() > should store SignedDispute with auto-computed hash and return hash with empty signatures`](../../../../../../../test/storage/DisputeStorage.test.ts#L32) (line 32) | [`REQ-DSTORE-1.T1.P1`](../../../../specification/storage/dispute-evidence.md#req-dstore-1-t1-p1), [`UNIT-TEST-DISPUTE-STORAGE-1.P1`](../../../../implementation/source/src/storage/DisputeStorage.ts.md#unit-test-dispute-storage-1.p1) |
| [`DisputeStorage > CREATE - storeDispute() > should store SignedDispute with provided hash`](../../../../../../../test/storage/DisputeStorage.test.ts#L41) (line 41)                                            | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > CREATE - storeDispute() > should return same hash on duplicate insert and preserve existing signatures`](../../../../../../../test/storage/DisputeStorage.test.ts#L53) (line 53)             | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > CREATE - storeDisputeConfirmation() > should store DisputeConfirmation with auto-computed hash`](../../../../../../../test/storage/DisputeStorage.test.ts#L75) (line 75)                     | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > CREATE - storeDisputeConfirmation() > should store DisputeConfirmation with provided hash`](../../../../../../../test/storage/DisputeStorage.test.ts#L85) (line 85)                          | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > CREATE - storeDisputeConfirmation() > should merge signatures with deduplication on duplicate insert`](../../../../../../../test/storage/DisputeStorage.test.ts#L97) (line 97)               | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > CREATE - storeDisputeConfirmation() > should handle empty signatures array`](../../../../../../../test/storage/DisputeStorage.test.ts#L141) (line 141)                                       | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > CREATE - storeDisputeConfirmation() > should preserve original SignedDispute when merging signatures`](../../../../../../../test/storage/DisputeStorage.test.ts#L155) (line 155)             | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > READ - getDisputeConfirmation() > should get dispute confirmation by hash`](../../../../../../../test/storage/DisputeStorage.test.ts#L190) (line 190)                                        | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > READ - getDisputeConfirmation() > should return undefined for non-existent dispute`](../../../../../../../test/storage/DisputeStorage.test.ts#L195) (line 195)                               | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > Edge cases and behavior > should handle multiple different disputes`](../../../../../../../test/storage/DisputeStorage.test.ts#L203) (line 203)                                              | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > Edge cases and behavior > should maintain signatures across different storage methods`](../../../../../../../test/storage/DisputeStorage.test.ts#L229) (line 229)                            | —                                                                                                                                                                                                                                       |
| [`DisputeStorage > Edge cases and behavior > should handle large signature arrays efficiently`](../../../../../../../test/storage/DisputeStorage.test.ts#L248) (line 248)                                       | —                                                                                                                                                                                                                                       |
