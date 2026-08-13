# test/scripts/e2eParallelWorkerScheduler.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelWorkerScheduler.test.ts](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests the admission and pacing layer shared by the local and distributed runners: `WorkerScheduler`, `AccountPartitionPool`/`accountPartitionFor`, `ResourceGate`, and `buildSlotEnv` from `scripts/e2e-parallel/shared/`, plus `parseServerArgs` defaults from `scripts/e2e-parallel/distributed/serverArgParser.js`. Schedulers are driven with injected `canRun`/`requestTask`/`runTask` callbacks and asserted on request counts, running totals, and timing. Oracles cover server defaults with short-flag overrides, the funded-account-partition pool that refuses over-acquisition and reuses released partitions, the always-admit-one and process-cap admission rules, conservative fallback with a single warning when `ps` sampling fails, an identical fully-populated slot environment for every scheduler (including the null-slot case), capacity that survives empty polls and wakes on a nudge, suppression of concurrent task requests and of timer retries after stop, refusal to start an assignment returned after stop, prefetch buffering of the next assignment before capacity opens, and pacing of successive admissions by the shared tick interval. All components are runner tooling under `scripts/`, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                              | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed worker scheduler > uses parallel-runner defaults and accepts server-local short overrides`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L23) (line 23) | —      |
| [`distributed worker scheduler > reuses only funded account partitions`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L40) (line 40)                                  | —      |
| [`distributed worker scheduler > uses the shared always-one and process-cap admission rules`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L55) (line 55)             | —      |
| [`distributed worker scheduler > falls back conservatively and warns once when ps fails`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L68) (line 68)                 | —      |
| [`distributed worker scheduler > builds the same complete slot environment for every scheduler`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L90) (line 90)          | —      |
| [`distributed worker scheduler > keeps capacity alive after no work and accepts a nudge`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L115) (line 115)               | —      |
| [`distributed worker scheduler > suppresses concurrent task requests and stops timer retries`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L142) (line 142)          | —      |
| [`distributed worker scheduler > does not start an assignment returned after the scheduler stops`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L169) (line 169)      | —      |
| [`distributed worker scheduler > buffers the next distributed assignment before capacity opens`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L195) (line 195)        | —      |
| [`distributed worker scheduler > paces successful admissions using the shared scheduler interval`](../../../../../../../test/scripts/e2eParallelWorkerScheduler.test.ts#L228) (line 228)      | —      |
