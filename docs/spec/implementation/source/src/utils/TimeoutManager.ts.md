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
- [x] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P3` — dispose cancels every pending timer and does not wait for a running task, which a send frozen at the disposal cut-off would hold forever; no timer outlives the disposal
- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P4` — reschedule patterns
- [x] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P5` — a task that fails is logged once at error through the manager's logger with its name and cause
- [x] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P6` — a task scheduled after dispose never runs and arms no timer, so work still running in a disposed runtime starts no timer
