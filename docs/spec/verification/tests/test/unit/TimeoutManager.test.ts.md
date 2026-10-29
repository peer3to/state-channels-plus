# TimeoutManager.test.ts

Test file: [test/unit/TimeoutManager.test.ts](../../../../../../test/unit/TimeoutManager.test.ts)
Exercises: [TimeoutManager.ts](../../../../implementation/source/src/utils/TimeoutManager.ts.md)

## Overview

The suite drives a real `TimeoutManager` under sinon fake timers with a real logger. A scheduled
task is started and still running when `dispose` begins; the task then settles. The oracles are
that `dispose` resolves only after the task finished and that no timer is left pending once it
resolves: the bound on the running-task wait is cleared, since a pending timer keeps a worker
thread alive after disposal until it fires. Scheduling, cancellation and rescheduling are out of
scope here.

## Tests

- `dispose waits for a running task and leaves no timer once it settles`: UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P3
