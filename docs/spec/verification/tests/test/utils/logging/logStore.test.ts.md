# test/utils/logging/logStore.test.ts — Test Report

> **Test file:** [test/utils/logging/logStore.test.ts](../../../../../../../test/utils/logging/logStore.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [logStore.ts](../../../../../implementation/source/src/utils/logging/logStore.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite constructs real `LogStore` instances, one with a bound small enough that forty entries
overflow it, and reads deltas past several cursors. The oracles are the delta's sequence range and
entries: numbers stay monotonic across eviction, a delta holds only what is past the cursor, an
empty delta leaves the cursor alone, and a start that jumped past the cursor is the gap eviction
left.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                        | Covers                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`LogStore > keeps sequence numbers monotonic across eviction`](../../../../../../../test/utils/logging/logStore.test.ts#L36) (line 36) | [`UNIT-TEST-LOG-STORE-1-279Z99.P1`](../../../../../implementation/source/src/utils/logging/logStore.ts.md#unit-test-log-store-1-279z99.p1), [`REQ-LOG-3-T9FM2K.T1.P1`](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k.t1.p1) |
| [`LogStore > returns only entries after the cursor`](../../../../../../../test/utils/logging/logStore.test.ts#L50) (line 50)            | [`UNIT-TEST-LOG-STORE-1-279Z99.P2`](../../../../../implementation/source/src/utils/logging/logStore.ts.md#unit-test-log-store-1-279z99.p2)                                                                                                            |
| [`LogStore > reports an empty delta without moving the cursor`](../../../../../../../test/utils/logging/logStore.test.ts#L65) (line 65) | [`UNIT-TEST-LOG-STORE-1-279Z99.P3`](../../../../../implementation/source/src/utils/logging/logStore.ts.md#unit-test-log-store-1-279z99.p3)                                                                                                            |
| [`LogStore > reports a gap when eviction outran the cursor`](../../../../../../../test/utils/logging/logStore.test.ts#L76) (line 76)    | [`UNIT-TEST-LOG-STORE-1-279Z99.P4`](../../../../../implementation/source/src/utils/logging/logStore.ts.md#unit-test-log-store-1-279z99.p4)                                                                                                            |
| [`LogStore > draws a 64-bit store id that no two stores share`](../../../../../../../test/utils/logging/logStore.test.ts#L24) (line 24) | [`UNIT-TEST-LOG-STORE-1-279Z99.P5`](../../../../../implementation/source/src/utils/logging/logStore.ts.md#unit-test-log-store-1-279z99.p5)                                                                                                            |
