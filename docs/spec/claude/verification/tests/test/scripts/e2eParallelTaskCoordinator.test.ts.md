# test/scripts/e2eParallelTaskCoordinator.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelTaskCoordinator.test.ts](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests `TaskCoordinator` from `scripts/e2e-parallel/shared/taskCoordinator.js`, the orchestrator-side assignment ledger of the parallel runner, by driving `requestTask` / `completeAttempt` / `disconnectWorker` / `finish` directly with synthetic workers. Oracles assert that a disconnected worker's last assignment is reissued with a fresh attempt id and idle workers are nudged via `onWorkAvailable`; that an infrastructure failure is retried once and a second one finalizes the task as failed with both diagnostics retained; that stale, duplicate, and cross-worker results are rejected as `accepted: false`; and, in speculative mode, that unfinished tasks are replicated in reverse order with the first result winning, a speculative failure stays provisional while another copy can still pass, a disconnected worker's provisional failure is finalized when the last copy fails, and the same task is never assigned twice to one worker. Wire transfer, scheduling, and process execution are out of scope. The coordinator is test-orchestration tooling, not a production protocol component, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                        | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed task coordinator > wakes an idle worker when the last assignment is reissued`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L12) (line 12)                        | —      |
| [`distributed task coordinator > reissues one infrastructure failure and terminates on the second`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L35) (line 35)                 | —      |
| [`distributed task coordinator > rejects stale, duplicate, and cross-worker results`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L73) (line 73)                               | —      |
| [`distributed task coordinator > replicates unfinished tasks in reverse order and accepts the first result`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L94) (line 94)        | —      |
| [`distributed task coordinator > keeps a speculative failure provisional while another copy can pass`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L134) (line 134)            | —      |
| [`distributed task coordinator > finalizes a disconnected worker's provisional failure when the last copy fails`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L167) (line 167) | —      |
| [`distributed task coordinator > never assigns the same task twice to one worker`](../../../../../../../test/scripts/e2eParallelTaskCoordinator.test.ts#L205) (line 205)                                | —      |
