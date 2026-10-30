# PerformanceMonitorReporting.test.ts

Test file: [PerformanceMonitorReporting.test.ts](../../../../../../test/utils/PerformanceMonitorReporting.test.ts)
Exercises: [performanceMonitorInternal.ts.md](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md)

## Overview

Use a real logger store with explicit samples; inspect exact platform fields, strict thresholds, disabled errors and per-call config changes.

## Tests

- `reports exact Node verbose metadata below thresholds`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P1
- `reports browser defaults with estimated utilization only`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P2
- `warns and returns browser threshold details for long tasks alone`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P3
- `does not warn or trip at exact thresholds`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P4
- `warns and trips above the Node maximum threshold`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P5
- `disables threshold errors without disabling warnings`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P6
- `reads the current config threshold for each report`: UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P7
