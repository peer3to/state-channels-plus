# test/evm/workerShutdown.test.ts — Test Report

> **Test file:** [test/evm/workerShutdown.test.ts](../../../../../../../test/evm/workerShutdown.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [workerShutdown.ts](../../../../implementation/source/src/evm/node/workerShutdown.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A unit suite for `createWorkerShutdown`, driven with real `node:worker_threads` workers built
from inline eval scripts that close their parent port on request. The oracle is the returned
shutdown promise plus `worker.threadId === -1` (the thread really exited). The cases prove: the
shutdown resolves once a draining worker exits naturally; it resolves immediately for a worker
that already exited before `createWorkerShutdown`'s closure runs; a slow drain (delayed port
close) is awaited rather than abandoned; and ten concurrent shutdowns complete independently.
Forceful termination and the executor/runtime callers of this helper are out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                 | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`workerShutdown > resolves once the worker drains its loop and exits`](../../../../../../../test/evm/workerShutdown.test.ts#L18) (line 18)      | —      |
| [`workerShutdown > resolves immediately for an already-exited worker`](../../../../../../../test/evm/workerShutdown.test.ts#L28) (line 28)       | —      |
| [`workerShutdown > waits for a slow drain instead of abandoning the worker`](../../../../../../../test/evm/workerShutdown.test.ts#L41) (line 41) | —      |
| [`workerShutdown > completes concurrent shutdowns independently`](../../../../../../../test/evm/workerShutdown.test.ts#L59) (line 59)            | —      |
