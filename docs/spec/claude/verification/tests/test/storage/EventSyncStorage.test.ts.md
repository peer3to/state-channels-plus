# test/storage/EventSyncStorage.test.ts — Test Report

> **Test file:** [test/storage/EventSyncStorage.test.ts](../../../../../../../test/storage/EventSyncStorage.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventSyncStorage.ts](../../../../implementation/source/src/storage/EventSyncStorage.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two tests drive `EventSyncStorage` directly. The first stores watermarks for two channels —
including a lower value delivered under a case-variant of the first channel's id — and asserts
each channel reads back its own highest value, demonstrating per-channel isolation and that the
regression written through the normalized key is ignored. The second asserts a channel with no
stores reads back `undefined`. The key normalization itself is not independently discriminated
(that would need a variant-keyed higher store read back through the original key), and no test
advances a channel's watermark across successive increasing stores, so the case-unification and
advance permutations stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                              | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`EventSyncStorage > stores independent monotonic watermarks per normalized channel`](../../../../../../../test/storage/EventSyncStorage.test.ts#L8) (line 8) | [`REQ-RMSTORE-1-BWKVBG.T1.P2`](../../../../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg.t1.p2), [`REQ-RMSTORE-1-BWKVBG.T1.P3`](../../../../specification/storage/progress-markers.md#req-rmstore-1-bwkvbg.t1.p3), [`UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P2`](../../../../implementation/source/src/storage/EventSyncStorage.ts.md#unit-test-event-sync-storage-1-0nknw0.p2), [`UNIT-TEST-EVENT-SYNC-STORAGE-1-0NKNW0.P4`](../../../../implementation/source/src/storage/EventSyncStorage.ts.md#unit-test-event-sync-storage-1-0nknw0.p4) |
| [`EventSyncStorage > has no cursor until an event-bearing block is published`](../../../../../../../test/storage/EventSyncStorage.test.ts#L24) (line 24)      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
