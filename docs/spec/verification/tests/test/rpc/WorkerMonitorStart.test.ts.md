# WorkerMonitorStart.test.ts

Test file: [test/rpc/WorkerMonitorStart.test.ts](../../../../../../test/rpc/WorkerMonitorStart.test.ts)
Exercises: [AInternalRpcRoot](../../../../implementation/source/src/rpc/internal/AInternalRpcRoot.ts.md)

## Overview

Verifies when a worker root starts its thread's event-loop monitor, with and without the opt-in
startup monitoring.

## Tests

- `starts a worker root's monitor once its start is done by default`: UNIT-TEST-ROOT-MONITOR-START-1-MAY5GB.P1
- `starts a worker root's monitor before its start with EVENT_LOOP_MONITOR_STARTUP`: UNIT-TEST-ROOT-MONITOR-START-1-MAY5GB.P2
