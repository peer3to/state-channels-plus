# TimeoutManager.ts

> **Source:** [src/utils/TimeoutManager.ts](../../../../../../src/utils/TimeoutManager.ts)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK

Scheduling lifecycle

- Setup: Schedule/cancel/dispose under load
- Oracle: Exactly-once firing or cancellation; disposal drains all

- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P1` — fire
- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P2` — cancel
- [x] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P3` — dispose drain: it waits for running tasks and clears its wait bound once they settle, so no timer outlives the disposal
- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P4` — reschedule patterns
