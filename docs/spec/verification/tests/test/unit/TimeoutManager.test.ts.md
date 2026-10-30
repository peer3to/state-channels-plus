# TimeoutManager.test.ts

Test file: [test/unit/TimeoutManager.test.ts](../../../../../../test/unit/TimeoutManager.test.ts)
Exercises: [TimeoutManager.ts](../../../../implementation/source/src/utils/TimeoutManager.ts.md)

## Overview

The suite drives a real `TimeoutManager` under sinon fake timers with a real logger. One scheduled
task is running and never settles (a task frozen on a send cut at disposal) and another is still
pending when `dispose` runs. The oracles are that `dispose` returns without waiting for the
running task, that the pending task never runs, and that no timer is left pending, since a pending
timer keeps a worker thread alive after disposal until it fires. A second case schedules a task
that rejects and spies on the real logger's `error`: it is called once, with a message naming the
task and the cause as its metadata. Scheduling, cancellation and rescheduling are out of scope here.

## Tests

- `dispose cancels pending timers and returns while a task still runs`: UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P3
- `logs a failing task once at error with its name and cause`: UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P5
