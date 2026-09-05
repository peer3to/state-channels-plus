# test/harness/ScheduledTaskHolds.test.ts — Test Report

> **Test file:** [test/harness/ScheduledTaskHolds.test.ts](../../../../../../test/harness/ScheduledTaskHolds.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** the harness control stub [test/fixtures/customRpc/harnessControl/services/stub/StubRpcMethods.ts](../../../../../../test/fixtures/customRpc/harnessControl/services/stub/StubRpcMethods.ts) (`stubHoldScheduledTasks` / `restoreHeldScheduledTasks`); harness code has no source report.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One case for the scheduled-task hold's prefix dispatcher on a live two-participant channel. It installs holds for two prefixes, schedules real zero-delay tasks host-side under each prefix and under an unrelated name, restores the older prefix first, and proves the newer prefix stays held while the older one and unrelated names run; restoring the newer prefix with replay then returns the real scheduler. The stub is harness code, so the row stays unassigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                        | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`scheduled task holds > keeps the newer prefix held when the older prefix is restored first`](../../../../../../test/harness/ScheduledTaskHolds.test.ts#L30) (line 30) | —      |
