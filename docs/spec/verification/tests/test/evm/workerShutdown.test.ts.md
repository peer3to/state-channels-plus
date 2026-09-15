# test/evm/workerShutdown.test.ts — Test Report

> **Test file:** [test/evm/workerShutdown.test.ts](../../../../../../test/evm/workerShutdown.test.ts) > **Status:** Authored — engineer verification pending.
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

| Test declaration                                                                                                                              | Covers                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`workerShutdown > resolves once the worker drains its loop and exits`](../../../../../../test/evm/workerShutdown.test.ts#L8) (line 8)        | —                                                                                                                                                                        |
| [`workerShutdown > resolves immediately for an already-exited worker`](../../../../../../test/evm/workerShutdown.test.ts#L18) (line 18)       | —                                                                                                                                                                        |
| [`workerShutdown > waits for a slow drain instead of abandoning the worker`](../../../../../../test/evm/workerShutdown.test.ts#L31) (line 31) | —                                                                                                                                                                        |
| [`workerShutdown > completes concurrent shutdowns independently`](../../../../../../test/evm/workerShutdown.test.ts#L49) (line 49)            | —                                                                                                                                                                        |
| [`Worker resource policy > uses the shared default when no override exists`](../../../../../../test/evm/workerShutdown.test.ts#L69) (line 69) | [`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P1`](../../../../implementation/source/src/evm/node/workerResourceLimits.ts.md#unit-test-worker-resource-limits-1-9hcgk8.p1) |
| [`Worker resource policy > uses a finite positive override`](../../../../../../test/evm/workerShutdown.test.ts#L72) (line 72)                 | [`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P2`](../../../../implementation/source/src/evm/node/workerResourceLimits.ts.md#unit-test-worker-resource-limits-1-9hcgk8.p2) |
| [`Worker resource policy > disables the cap for zero`](../../../../../../test/evm/workerShutdown.test.ts#L75) (line 75)                       | [`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P3`](../../../../implementation/source/src/evm/node/workerResourceLimits.ts.md#unit-test-worker-resource-limits-1-9hcgk8.p3) |
| [`Worker resource policy > disables the cap for a negative override`](../../../../../../test/evm/workerShutdown.test.ts#L78) (line 78)        | [`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P4`](../../../../implementation/source/src/evm/node/workerResourceLimits.ts.md#unit-test-worker-resource-limits-1-9hcgk8.p4) |
| [`Worker resource policy > falls back for a non-finite override`](../../../../../../test/evm/workerShutdown.test.ts#L81) (line 81)            | [`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P5`](../../../../implementation/source/src/evm/node/workerResourceLimits.ts.md#unit-test-worker-resource-limits-1-9hcgk8.p5) |
| [`Worker resource policy > falls back for an invalid override`](../../../../../../test/evm/workerShutdown.test.ts#L84) (line 84)              | [`UNIT-TEST-WORKER-RESOURCE-LIMITS-1-9HCGK8.P6`](../../../../implementation/source/src/evm/node/workerResourceLimits.ts.md#unit-test-worker-resource-limits-1-9hcgk8.p6) |
