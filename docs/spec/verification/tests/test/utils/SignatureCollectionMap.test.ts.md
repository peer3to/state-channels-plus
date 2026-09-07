# test/utils/SignatureCollectionMap.test.ts — Test Report

> **Test file:** [test/utils/SignatureCollectionMap.test.ts](../../../../../../test/utils/SignatureCollectionMap.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SignatureCollectionMap.ts](../../../../implementation/source/src/utils/SignatureCollectionMap.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Use real signed values across multiple keys; compare fresh ordered arrays and live iteration after callback mutation.

A pure in-memory unit drive of `SignatureCollectionMap` — `tryInsert`, `has`, `hasSignature`,
`getSignatures`, `didEveryoneSign`, `delete`, `clear`, and `size` — with string keys, fixed
addresses, and placeholder signature strings, under sinon fake timers for the optional TTL. The
oracles assert per-address deduplication (a second signature from the same address is ignored),
completeness checks against a participant list (including a missing signer and a non-existent
key), and the timeout path: an entry with `timeoutMs` evicts exactly at expiry, an entry without
one never evicts, and manual deletion cancels the pending timer without a late-firing error. Out
of scope: real cryptographic signatures, address case/checksum normalization, and every
protocol-level consumer of collected signatures. The seed pool defines no permutations for this
component, so no test IDs are assignable here.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                            | Covers                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SignatureCollectionMap > should insert a new signature`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L59) (line 59)                                                       | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should insert multiple signatures for the same key`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L70) (line 70)                                  | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should prevent duplicate signatures from the same address`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L85) (line 85)                           | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should return true when all participants have signed`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L99) (line 99)                                | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should return false when not all participants have signed`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L114) (line 114)                         | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should return false for non-existent key`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L129) (line 129)                                          | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should delete entries`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L134) (line 134)                                                             | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should clear all entries`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L145) (line 145)                                                          | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should set timeout when provided`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L157) (line 157)                                                  | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should not timeout when no timeout provided`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L176) (line 176)                                       | —                                                                                                                                                                             |
| [`SignatureCollectionMap > should clear timeout when manually deleting`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L186) (line 186)                                       | —                                                                                                                                                                             |
| [`SignatureCollectionMap > projects ordered signatures into fresh arrays and preserves live callback iteration`](../../../../../../test/utils/SignatureCollectionMap.test.ts#L27) (line 27) | [`UNIT-TEST-SIGNATURE-COLLECTION-MAP-32-KB4QYC.P1`](../../../../implementation/source/src/utils/SignatureCollectionMap.ts.md#unit-test-signature-collection-map-32-kb4qyc.p1) |
