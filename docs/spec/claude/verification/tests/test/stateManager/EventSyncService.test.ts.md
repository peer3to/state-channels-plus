# test/stateManager/EventSyncService.test.ts — Test Report

> **Test file:** [test/stateManager/EventSyncService.test.ts](../../../../../../../test/stateManager/EventSyncService.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EventSyncService.ts](../../../../implementation/source/src/stateManager/EventSyncService.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two worker-realm probes drive the real `EventSyncService` of a live four-peer session through
harness-control stubs. `probeRejectedEventSyncLog` asserts the fatal-log policy: a log whose
handler rejects is never re-dispatched — the same promise is replayed to every waiter (handler
called once, the identical error surfaces on the first await, the second await, the detached
chain, and a later reschedule) and the per-channel cursor does not advance past the failure.
`probeConcurrentCalldataRecovery` asserts that concurrent calldata-recovery requests join one
in-flight chain query (two queries total across first/second/retry probes) and consistently
report the calldata as not found. Ordering across out-of-order log delivery, gap recovery within
attempt caps, and restart resume are not exercised here, so the service's planned permutations
stay unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                     | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`EventSyncService > treats a failed log as fatal - never re-dispatched, cursor holds`](../../../../../../../test/stateManager/EventSyncService.test.ts#L6) (line 6) | —      |
| [`EventSyncService > joins concurrent calldata recovery onto one chain query`](../../../../../../../test/stateManager/EventSyncService.test.ts#L27) (line 27)        | —      |
