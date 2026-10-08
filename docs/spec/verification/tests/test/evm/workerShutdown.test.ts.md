# workerShutdown.test.ts

Test file: [test/evm/workerShutdown.test.ts](../../../../../../test/evm/workerShutdown.test.ts)
Exercises: [workerShutdown.ts](../../../../implementation/source/src/evm/node/workerShutdown.ts.md)

## Overview

A unit suite for `createWorkerShutdown`, driven with real `node:worker_threads` workers built
from inline eval scripts that close their parent port on request. The oracle is the returned
shutdown promise plus `worker.threadId === -1` (the thread really exited). The cases prove: the
shutdown resolves once a draining worker exits naturally; it resolves immediately for a worker
that already exited before `createWorkerShutdown`'s closure runs; a slow drain (delayed port
close) is awaited rather than abandoned; and ten concurrent shutdowns complete independently.
Forceful termination and the executor/runtime callers of this helper are out of scope.

## Tests

- `resolves once the worker drains its loop and exits`: none
- `resolves immediately for an already-exited worker`: none
- `waits for a slow drain instead of abandoning the worker`: none
- `completes concurrent shutdowns independently`: none
- `uses the shared default when no override exists`: UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P1
- `uses a finite positive override`: UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P2
- `disables the cap for zero`: UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P3
- `disables the cap for a negative override`: UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P4
- `falls back for a non-finite override`: UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P5
- `falls back for an invalid override`: UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P6
