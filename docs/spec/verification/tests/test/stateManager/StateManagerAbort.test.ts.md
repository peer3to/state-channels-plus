# test/stateManager/StateManagerAbort.test.ts — Test Report

> **Test file:** [test/stateManager/StateManagerAbort.test.ts](../../../../../../test/stateManager/StateManagerAbort.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [StateManager.ts](../../../../implementation/source/src/stateManager/StateManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single case drives `StateManager.abort()` on a live four-peer harness session, executed in
the peer's worker realm via `execOnHost`. It schedules a task through the session-owned
`timeoutManager`, aborts, and then waits past the task's due time. The oracles assert that abort
cancels session-owned timeout work (the task never runs), leaves the manager's status at
`OPENED`, disconnects every peer (`getConnectedPeers` is empty), and fires the `onAbort` hook on
the main thread. Full disposal semantics (worker teardown, storage release) are out of scope —
the case isolates abort's cancellation and disconnect effects.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                       | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`StateManager abort > cancels session-owned timeout work`](../../../../../../test/stateManager/StateManagerAbort.test.ts#L7) (line 7) | —      |
