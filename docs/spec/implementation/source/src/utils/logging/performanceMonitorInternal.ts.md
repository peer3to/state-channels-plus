# performanceMonitorInternal.ts

> **Source:** [src/utils/logging/performanceMonitorInternal.ts](../../../../../../../src/utils/logging/performanceMonitorInternal.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-RUNTIME-3-VQXW59` (Lifecycle convergence)](../../../../../specification/runtime/execution.md#req-runtime-3-vqxw59)

## UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN

Performance report projection

- Setup: Use a real logger store with explicit samples; inspect exact platform fields, strict thresholds, disabled errors and per-call config changes.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P1` — reports exact Node verbose metadata below thresholds
- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P2` — reports browser defaults with estimated utilization only
- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P3` — warns and returns browser threshold details for long tasks alone
- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P4` — does not warn or trip at exact thresholds
- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P5` — warns and trips above the Node maximum threshold
- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P6` — disables threshold errors without disabling warnings
- [x] `UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P7` — reads the current config threshold for each report
