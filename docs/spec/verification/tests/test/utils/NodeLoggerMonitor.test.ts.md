# test/utils/NodeLoggerMonitor.test.ts — Test Report

> **Test file:** [test/utils/NodeLoggerMonitor.test.ts](../../../../../../test/utils/NodeLoggerMonitor.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [NodeLogger.ts](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md), [Logger.ts](../../../../implementation/source/src/utils/logging/Logger.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Run the real monitor with a scripted source or real histogram; inspect source counts, peak marker output, early stop and source-initialization warning.

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

| Test declaration                                                                                                                                                                                                                                                                      | Covers                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`NodeLogger performance monitor > throws the unchanged watchdog message with structured delay data once a sample crosses the threshold`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L48) (line 48)                                                                       | [`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P1`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-monitor-1-s8qme5)                                                                                                |
| [`NodeLogger performance monitor > stops sampling after the throw so a later tick reports nothing`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L79) (line 79)                                                                                                             | [`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P2`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-monitor-1-s8qme5)                                                                                                |
| [`NodeLogger performance monitor > keeps sampling quietly while every sample stays below the threshold`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L113) (line 113)                                                                                                      | [`UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P3`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-monitor-1-s8qme5)                                                                                                |
| [`NodeLogger performance monitor > resets after each sample and stops the source on explicit stop`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L125) (line 125)                                                                                                           | [`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P1`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-32-b1jtby)                                                                                                              |
| [`NodeLogger performance monitor > can stop before the real sample source becomes ready`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L161) (line 161)                                                                                                                     | [`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P2`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-32-b1jtby)                                                                                                              |
| [`NodeLogger performance monitor > emits timing markers only when the running peak increases`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L180) (line 180)                                                                                                                | [`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P3`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-32-b1jtby)                                                                                                              |
| [`NodeLogger performance monitor > warns when the real histogram source rejects an invalid resolution`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L203) (line 203)                                                                                                       | [`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P4`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-32-b1jtby)                                                                                                              |
| [`NodeLogger performance monitor > attaches the thread's CPU time and run-queue wait and the host's busy and steal share to real main-thread samples where the kernel exposes them and omits them elsewhere`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L230) (line 230) | [`UNIT-TEST-NODE-LOGGER-32-B1JTBY.P5`](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md#unit-test-node-logger-32-b1jtby), [`REQ-RUNTIME-3-VQXW59.T1.P60`](../../../../specification/runtime/execution.md#req-runtime-3-vqxw59.t1.p60) |
| [`NodeLogger performance monitor > shares one monitor across loggers and makes repeated start and stop harmless`](../../../../../../test/utils/NodeLoggerMonitor.test.ts#L283) (line 283)                                                                                             | [`UNIT-TEST-LOGGER-1-4MNRMD.P4`](../../../../implementation/source/src/utils/logging/Logger.ts.md#unit-test-logger-1-4mnrmd)                                                                                                                                   |
