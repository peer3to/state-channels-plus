# test/scripts/e2eParallelDistributedLifecycle.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelDistributedLifecycle.test.ts](../../../../../../../test/scripts/e2eParallelDistributedLifecycle.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite drives multi-node lease lifecycle scenarios for the distributed e2e runner through the `LeasePoolHarness` fixture (`test/fixtures/distributed/leasePool`), which stands up real worker servers and orchestrators on a shared pool and records the protocol events each orchestrator observes. Oracles assert on the observed `LEASE_GRANTED` / `BUSY` / `LEASE_CLEAN` / `CONNECTION_CLOSED` event stream and on connection counts: simultaneous bidirectional discovery deduplicates into a single lease, a killed server can be replaced without disturbing the orchestrator or the surviving server, a queued second orchestrator receives progress updates (position, completed tasks, estimated wait) and is promoted on every server once the first releases, a killed lease owner promotes the waiting orchestrator, and a new orchestrator after a clean release is granted immediately without ever seeing `BUSY`. Task execution, workspace preparation, and log transfer are out of scope here. The suite exercises the `scripts/e2e-parallel/distributed/` test-orchestration tooling, not a production protocol component, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                       | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed worker pool lifecycle > deduplicates simultaneous bidirectional discovery into one lease`](../../../../../../../test/scripts/e2eParallelDistributedLifecycle.test.ts#L5) (line 5)                        | —      |
| [`distributed worker pool lifecycle > keeps the orchestrator and surviving server active while a replacement server rejoins`](../../../../../../../test/scripts/e2eParallelDistributedLifecycle.test.ts#L25) (line 25) | —      |
| [`distributed worker pool lifecycle > keeps a second orchestrator connected with progress and promotes it on every server`](../../../../../../../test/scripts/e2eParallelDistributedLifecycle.test.ts#L62) (line 62)   | —      |
| [`distributed worker pool lifecycle > promotes the waiting orchestrator when the lease owner is killed`](../../../../../../../test/scripts/e2eParallelDistributedLifecycle.test.ts#L142) (line 142)                    | —      |
| [`distributed worker pool lifecycle > grants a new orchestrator immediately after the previous run finishes`](../../../../../../../test/scripts/e2eParallelDistributedLifecycle.test.ts#L166) (line 166)               | —      |
