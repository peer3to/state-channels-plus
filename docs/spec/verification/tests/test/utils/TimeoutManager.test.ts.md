# test/utils/TimeoutManager.test.ts — Test Report

> **Test file:** [test/utils/TimeoutManager.test.ts](../../../../../../test/utils/TimeoutManager.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [TimeoutManager.ts](../../../../implementation/source/src/utils/TimeoutManager.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Five direct literal cases drive a real `TimeoutManager` through its public surface — `scheduleTask`,
`cancelTask`, `cancelAllTasks`, `dispose` — with no harness and no stubbing of the class itself; the only
collaborator is the no-op logger. The subject is the optional fourth `scheduleTask` argument, the handler
that runs when the manager cancels a task wholesale, and the oracle in every case is a counter the handler
increments, compared as an exact number rather than a truthy check.

Four of the five cases schedule at a 60-second delay that the shared constant names `NEVER_MS`, so no case
can pass because a timer happened to fire: each one settles the task itself, by cancelling or disposing. The
two positive cases take the two wholesale paths separately — `cancelAllTasks()` (the channel reset's step)
and `dispose()` (the terminal path behind the same body) — and each expects exactly one run, so a handler
run twice fails as loudly as one never run.

The two negative cases are the boundaries that decide whether the handler is a cancellation signal or just a
second completion callback. In the owner-cancel case the owner calls `cancelTask` on the handle it was given
and the test then calls `cancelAllTasks()` anyway: the handler must not run on either, because the owner
already settled its own waiter and a second settle would be a double-resolution. In the already-fired case
the task is scheduled at zero delay and awaited past its firing, and the assertion is one structure — the
task body ran once and the handler never ran — so a report of "cancelled" for work that actually completed
cannot pass. The last case schedules a throwing handler ahead of a counting one and asserts the second still
ran, which is the isolation property: one broken owner must not strand every other waiter in the runtime.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree.

| Test declaration                                                                                                                                                               | Covers                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`TimeoutManager cancel handlers > runs a pending task's cancel handler when all tasks are cancelled`](../../../../../../test/utils/TimeoutManager.test.ts#L10) (line 10)      | [`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P5`](../../../../implementation/source/src/utils/TimeoutManager.ts.md#unit-test-timeout-manager-1-jngdyk.p5) |
| [`TimeoutManager cancel handlers > runs a pending task's cancel handler on disposal`](../../../../../../test/utils/TimeoutManager.test.ts#L27) (line 27)                       | [`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P6`](../../../../implementation/source/src/utils/TimeoutManager.ts.md#unit-test-timeout-manager-1-jngdyk.p6) |
| [`TimeoutManager cancel handlers > does not run the cancel handler when the owner cancels the task itself`](../../../../../../test/utils/TimeoutManager.test.ts#L44) (line 44) | [`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P7`](../../../../implementation/source/src/utils/TimeoutManager.ts.md#unit-test-timeout-manager-1-jngdyk.p7) |
| [`TimeoutManager cancel handlers > does not run the cancel handler of a task that already fired`](../../../../../../test/utils/TimeoutManager.test.ts#L62) (line 62)           | [`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P8`](../../../../implementation/source/src/utils/TimeoutManager.ts.md#unit-test-timeout-manager-1-jngdyk.p8) |
| [`TimeoutManager cancel handlers > keeps cancelling the rest when one cancel handler throws`](../../../../../../test/utils/TimeoutManager.test.ts#L83) (line 83)               | [`UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P9`](../../../../implementation/source/src/utils/TimeoutManager.ts.md#unit-test-timeout-manager-1-jngdyk.p9) |
