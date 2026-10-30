# NodeLogger.ts

> **Source:** [src/utils/logging/node/NodeLogger.ts](../../../../../../../../src/utils/logging/node/NodeLogger.ts)

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
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P3` — emits real histogram timing markers only when the running peak increases
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P4` — warns when the real histogram source rejects an invalid resolution
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P5` — a real main-thread sample carries the thread's CPU time and run-queue wait and the host's busy and steal share where the kernel exposes them, and none of them elsewhere
- [x] `UNIT-TEST-NODE-LOGGER-32-B1JTBY.P6` — omits scripted samples from timing markers even when reporting is enabled, while preserving the watchdog throw

## UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB

Every rendered line names its thread

- Setup: Write one info line with peer and component context through a real `NodeLogger` and capture its console line for that write only; vary the shared context's thread name: absent, `main`, `sdk`, `vm` and a consumer name (`prover`).
- Oracle: Exactly one rendered line; with colors removed it is time, level, peer, exactly one thread label, component, then the unchanged message; an absent name renders `main`.

- [x] `UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P1` — a line whose context names no thread renders `[main]`
- [x] `UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P2` — a `main` line renders `[main]`
- [x] `UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P3` — an `sdk` line renders `[sdk]`
- [x] `UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P4` — a `vm` line renders `[vm]`
- [x] `UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P5` — a consumer `prover` line renders `[prover]`
