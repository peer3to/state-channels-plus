# test/scripts/e2eParallelOrchestratorLog.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelOrchestratorLog.test.ts](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests the attempt-log pipeline of the distributed runner: `OrchestratorLogStore` and `sanitizeWorkerLabel`, `WorkerAttemptSpool`, the log-path helpers in `scripts/e2e-parallel/shared/logging.js`, orchestrator helpers (`createWorkerColorRegistry`, `createHeartbeatMonitor`, `promoteAttemptLog`, `aggregateWorkerStats`, `validateWorkerStats`), and the server-side decisions `shouldTransferAttemptLog` / `acknowledgeLoglessAttempt`. Oracles assert that worker colors stay stable across reconnects, attempt logs transfer only on failure or infrastructure fault, successful attempts are acknowledged without waiting for a log, a provisional failure is promoted into the canonical `error_` log after its worker disconnects, silent peers expire via the heartbeat monitor, resource samples aggregate correctly and invalid statistics throw, generated filenames stay under the 255-byte filesystem limit, the store writes exact ordered ANSI bytes and commits only against a matching SHA-256, infrastructure process logs (discovery/hardhat) land in separate `infra/` files with their trigger and failure context, hostile sequences/checksums/paths are rejected, and a full bounded spool fails only its own attempt. Everything under test lives in `scripts/e2e-parallel/`, developer tooling outside the specified production surface, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                   | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed orchestrator logs > keeps worker colors stable across reconnects`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L34) (line 34)                               | —      |
| [`distributed orchestrator logs > transfers attempt logs only for failures`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L44) (line 44)                                   | —      |
| [`distributed orchestrator logs > acknowledges a successful attempt without waiting for a log`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L55) (line 55)                | —      |
| [`distributed orchestrator logs > promotes a provisional failure after its worker disconnects`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L73) (line 73)                | —      |
| [`distributed orchestrator logs > expires a server that stops sending application frames`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L103) (line 103)                   | —      |
| [`distributed orchestrator logs > aggregates real resource samples across workers`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L117) (line 117)                          | —      |
| [`distributed orchestrator logs > keeps canonical, failure, and attempt filenames within filesystem limits`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L155) (line 155) | —      |
| [`distributed orchestrator logs > writes exact ordered ANSI bytes and commits only the matching hash`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L179) (line 179)       | —      |
| [`distributed orchestrator logs > writes failed discovery and hardhat process logs separately`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L206) (line 206)              | —      |
| [`distributed orchestrator logs > rejects duplicate sequences, bad checksums, and hostile worker paths`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L274) (line 274)     | —      |
| [`distributed orchestrator logs > fails only the attempt when its bounded spool fills`](../../../../../../../test/scripts/e2eParallelOrchestratorLog.test.ts#L319) (line 319)                      | —      |
