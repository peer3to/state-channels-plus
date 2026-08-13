# test/utils/SignatureCollectionMap.test.ts — Test Report

> **Test file:** [test/utils/SignatureCollectionMap.test.ts](../../../../../../../test/utils/SignatureCollectionMap.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [SignatureCollectionMap.ts](../../../../implementation/source/src/utils/SignatureCollectionMap.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

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

| Test declaration                                                                                                                                                     | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`SignatureCollectionMap > should insert a new signature`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L26) (line 26)                             | —      |
| [`SignatureCollectionMap > should insert multiple signatures for the same key`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L37) (line 37)        | —      |
| [`SignatureCollectionMap > should prevent duplicate signatures from the same address`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L52) (line 52) | —      |
| [`SignatureCollectionMap > should return true when all participants have signed`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L66) (line 66)      | —      |
| [`SignatureCollectionMap > should return false when not all participants have signed`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L81) (line 81) | —      |
| [`SignatureCollectionMap > should return false for non-existent key`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L96) (line 96)                  | —      |
| [`SignatureCollectionMap > should delete entries`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L101) (line 101)                                   | —      |
| [`SignatureCollectionMap > should clear all entries`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L112) (line 112)                                | —      |
| [`SignatureCollectionMap > should set timeout when provided`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L124) (line 124)                        | —      |
| [`SignatureCollectionMap > should not timeout when no timeout provided`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L143) (line 143)             | —      |
| [`SignatureCollectionMap > should clear timeout when manually deleting`](../../../../../../../test/utils/SignatureCollectionMap.test.ts#L153) (line 153)             | —      |
