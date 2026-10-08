# ScheduledTaskHolds.test.ts

Test file: [test/harness/ScheduledTaskHolds.test.ts](../../../../../../test/harness/ScheduledTaskHolds.test.ts)
Exercises: the harness control stub [test/fixtures/customRpc/harnessControl/services/stub/StubRpcMethods.ts](../../../../../../test/fixtures/customRpc/harnessControl/services/stub/StubRpcMethods.ts) (`stubHoldScheduledTasks` / `restoreHeldScheduledTasks`); harness code has no source report.

## Overview

One case for the scheduled-task hold's prefix dispatcher on a live two-participant channel. It installs holds for two prefixes, schedules real zero-delay tasks host-side under each prefix and under an unrelated name, restores the older prefix first, and proves the newer prefix stays held while the older one and unrelated names run; restoring the newer prefix with replay then returns the real scheduler. The stub is harness code, so the row stays unassigned.

## Tests

- `keeps the newer prefix held when the older prefix is restored first`: none
