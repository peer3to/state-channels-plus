# test/utils/PerformanceMonitorReporting.test.ts — Test Report

> **Test file:** [PerformanceMonitorReporting.test.ts](../../../../../../test/utils/PerformanceMonitorReporting.test.ts)  
> **Status:** Authored — engineer verification pending.  
> **Exercises:** [performanceMonitorInternal.ts.md](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md)

## Overview

Use a real logger store with explicit samples; inspect exact platform fields, strict thresholds, disabled errors and per-call config changes.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                     | Covers                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`performance monitor reporting > reports exact Node verbose metadata below thresholds`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L9) (line 9)               | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P1`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p1) |
| [`performance monitor reporting > reports browser defaults with estimated utilization only`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L25) (line 25)         | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P2`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p2) |
| [`performance monitor reporting > warns and returns browser threshold details for long tasks alone`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L47) (line 47) | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P3`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p3) |
| [`performance monitor reporting > does not warn or trip at exact thresholds`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L64) (line 64)                        | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P4`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p4) |
| [`performance monitor reporting > warns and trips above the Node maximum threshold`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L73) (line 73)                 | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P5`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p5) |
| [`performance monitor reporting > disables threshold errors without disabling warnings`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L82) (line 82)             | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P6`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p6) |
| [`performance monitor reporting > reads the current config threshold for each report`](../../../../../../test/utils/PerformanceMonitorReporting.test.ts#L91) (line 91)               | [`UNIT-TEST-PERFORMANCE-MONITOR-INTERNAL-32-X9NTGN.P7`](../../../../implementation/source/src/utils/logging/performanceMonitorInternal.ts.md#unit-test-performance-monitor-internal-32-x9ntgn.p7) |
