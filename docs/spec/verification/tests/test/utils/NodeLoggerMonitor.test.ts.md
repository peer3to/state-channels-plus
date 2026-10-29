# NodeLoggerMonitor.test.ts

Test file: [test/utils/NodeLoggerMonitor.test.ts](../../../../../../test/utils/NodeLoggerMonitor.test.ts)
Exercises: [NodeLogger.ts](../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md), [Logger.ts](../../../../implementation/source/src/utils/logging/Logger.ts.md)

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

The real-histogram timing case captures its native wait callback before Sinon installs fake timers. Run 452 exposed that Sinon also replaces the promise-based timer; waiting for it without advancing the fake clock deadlocked the case. Runtime revalidation is pending.

## Tests

- `throws the unchanged watchdog message with structured delay data once a sample crosses the threshold`: UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P1
- `stops sampling after the throw so a later tick reports nothing`: UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P2
- `keeps sampling quietly while every sample stays below the threshold`: UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P3
- `resets after each sample and stops the source on explicit stop`: UNIT-TEST-NODE-LOGGER-32-B1JTBY.P1
- `can stop before the real sample source becomes ready`: UNIT-TEST-NODE-LOGGER-32-B1JTBY.P2
- `omits scripted samples from timing markers even when reporting is enabled`: UNIT-TEST-NODE-LOGGER-32-B1JTBY.P6
- `emits real histogram timing markers only when the running peak increases`: UNIT-TEST-NODE-LOGGER-32-B1JTBY.P3
- `warns when the real histogram source rejects an invalid resolution`: UNIT-TEST-NODE-LOGGER-32-B1JTBY.P4
- `attaches the thread's CPU time and run-queue wait and the host's busy and steal share to real main-thread samples where the kernel exposes them and omits them elsewhere`: UNIT-TEST-NODE-LOGGER-32-B1JTBY.P5, REQ-RUNTIME-3-VQXW59.T1.P60
- `shares one monitor across loggers and makes repeated start and stop harmless`: UNIT-TEST-LOGGER-1-4MNRMD.P4
