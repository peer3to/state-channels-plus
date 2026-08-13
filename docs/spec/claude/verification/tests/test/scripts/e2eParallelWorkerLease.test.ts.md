# test/scripts/e2eParallelWorkerLease.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelWorkerLease.test.ts](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests the worker-side lease machinery of the distributed runner: `WorkerLeaseManager` and `LeaseRuntime` from `scripts/e2e-parallel/distributed/`, `acquireHostLock` from `hostLock.js`, and `progressElapsedMs` from `server.js`, all driven directly with synthetic connections. Oracles assert finite progress reporting while a leased workspace is still preparing, FIFO granting of one active lease with queued waiters, idempotent duplicate requests on the same connection, return to service (with an `onFault` report) when lease cleanup throws, queue-status publication with positions, progress, and 30-second wait estimates that update as waiters leave plus rejection of impossible progress, idempotent removal of the whole lease tree on cleanup, and an OS-held host lock that blocks a second acquisition, honors the explicit `allowSharedHost` bypass, and can be re-acquired after release (POSIX platforms only). Network transport and orchestrator behavior are out of scope. These components are test-orchestration tooling, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                     | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`distributed worker lease > reports finite progress while the leased workspace is still preparing`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L20) (line 20) | —      |
| [`distributed worker lease > grants one active lease and queued waiters in FIFO order`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L31) (line 31)              | —      |
| [`distributed worker lease > keeps duplicate requests on one connection idempotent`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L58) (line 58)                 | —      |
| [`distributed worker lease > returns to service when lease cleanup fails`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L76) (line 76)                           | —      |
| [`distributed worker lease > publishes queue progress, wait estimates, and updated positions`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L101) (line 101)     | —      |
| [`distributed worker lease > removes the complete lease tree and makes cleanup idempotent`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L162) (line 162)        | —      |
| [`distributed worker lease > uses an OS-held host lock and allows the explicit bypass`](../../../../../../../test/scripts/e2eParallelWorkerLease.test.ts#L176) (line 176)            | —      |
