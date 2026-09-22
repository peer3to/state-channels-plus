# TimeoutManager.ts

> **Source:** [src/utils/TimeoutManager.ts](../../../../../../src/utils/TimeoutManager.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK

Scheduling lifecycle

- Setup: Schedule/cancel/dispose under load
- Oracle: Exactly-once firing or cancellation; disposal drains all

- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P1` — fire
- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P2` — cancel
- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P3` — dispose drain
- [ ] `UNIT-TEST-TIMEOUT-MANAGER-1-JNGDYK.P4` — reschedule patterns
