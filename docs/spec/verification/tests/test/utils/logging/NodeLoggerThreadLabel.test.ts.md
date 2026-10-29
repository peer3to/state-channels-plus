# NodeLoggerThreadLabel.test.ts

Test file: [test/utils/logging/NodeLoggerThreadLabel.test.ts](../../../../../../../test/utils/logging/NodeLoggerThreadLabel.test.ts)
Exercises: [NodeLogger](../../../../../implementation/source/src/utils/logging/node/NodeLogger.ts.md)

## Overview

Each case writes one info line with a peer, a component and a message that holds brackets and
punctuation through a real `NodeLogger`, with the shared context's thread name absent, `main`, `sdk`,
`vm` or `prover`. The console sink is captured for that write only. Each case asserts that the logger
rendered exactly one line and that the line, with colors removed, matches the shared expectation from
start to end: time, level, peer, exactly one thread label, component, then the unchanged message. An
absent thread name renders `main`.

## Tests

- `renders main for a log line whose context names no thread`: UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P1
- `renders main for a main-thread log line`: UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P2
- `renders sdk for an SDK-thread log line`: UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P3
- `renders vm for a VM-thread log line`: UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P4
- `renders prover for a consumer prover-thread log line`: UNIT-TEST-NODE-LOGGER-THREAD-LABEL-1-26DRFB.P5
