# test/utils/NodeLoggerMonitor.test.ts — Test Report

> **Test file:** [test/utils/NodeLoggerMonitor.test.ts](../../../../../../test/utils/NodeLoggerMonitor.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [NodeLogger.ts](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md), [Logger.ts](../../../../implementation/source/src/utils/logging/Logger.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Direct process tests of the Node event-loop monitor on a real `createLogger` logger. Each case
zeroes the process-wide threshold for its duration (the monitor writes its timing marker to stdout
whenever that threshold is above zero), installs sinon fake timers, and starts the monitor through
`startPerformanceMonitoring` with the internal options: a scripted sample source, a 100 ms
threshold, a 50 ms interval, and `onStarted`, which the case awaits before ticking. The oracle is
the synchronous `clock.tick`: one over-threshold sample throws the unchanged message
`Event loop delay 1000ms exceeded configured threshold 100ms` with a structured `eventLoopDelay`
(`runtime: "node"`, `dMax`, threshold); after that throw the monitor has stopped itself, so further
ticks throw nothing; quiet samples never throw. The real perf_hooks source and the browser monitor
are not exercised here (the browser gate covers the browser trip end to end).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                | Covers                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`NodeLogger performance monitor > throws the unchanged watchdog message with structured delay data once a sample crosses the threshold`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L83) (line 83) | [`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P1`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-monitor-1-s8qme5.p1) |
| [`NodeLogger performance monitor > stops sampling after the throw so a later tick reports nothing`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L114) (line 114)                                     | [`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P2`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-monitor-1-s8qme5.p2) |
| [`NodeLogger performance monitor > keeps sampling quietly while every sample stays below the threshold`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L148) (line 148)                                | [`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P3`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-monitor-1-s8qme5.p3) |
