# NodeLogger.ts

> **Source:** [src/utils/logging/node/NodeLogger.ts](../../../../../../../../src/utils/logging/node/NodeLogger.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../../views/architecture/sdk/runtime-and-concurrency.md)

No specified behavior: Node logger implementation (console/stream sinks, colorized).

## UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5

Watchdog throw contract

- Setup: Start the monitor on a real logger with a scripted sample source and a synthetic threshold under fake timers
- Oracle: Exactly one throw with the unchanged message and structured delay data; sampling stops after it; quiet samples never throw

- [x] `UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P1` — one over-threshold sample throws the unchanged message with `eventLoopDelay` data
- [x] `UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P2` — sampling stops after the throw so a later tick reports nothing
- [x] `UNIT-TEST-NODE-LOGGER-MONITOR-1-S8QME5.P3` — samples below the threshold keep the monitor quiet

## UNIT-TEST-NODE-LOGGER-32-B1JTBY

Monitor lifecycle

- Setup: Run the real monitor with a scripted source or real histogram; inspect source counts, peak marker output, early stop and source-initialization warning.
- Oracle: Each variation below states its observable result; preserve all unrelated stored state and lifecycle policy.

- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P1` — resets after each sample and stops the source on explicit stop
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P2` — can stop before the real sample source becomes ready
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P3` — emits timing markers only when the running peak increases
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P4` — warns when the real histogram source rejects an invalid resolution
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P5` — a real main-thread sample carries the thread's CPU time and run-queue wait and the host's busy and steal share where the kernel exposes them, and none of them elsewhere
