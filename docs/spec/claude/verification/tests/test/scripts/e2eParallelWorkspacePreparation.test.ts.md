# test/scripts/e2eParallelWorkspacePreparation.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelWorkspacePreparation.test.ts](../../../../../../../test/scripts/e2eParallelWorkspacePreparation.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests workspace preparation on a distributed worker: `prepareWorkspace`/`selectPrepareScript` from `scripts/e2e-parallel/distributed/workspacePreparation.js` and `buildWorkerEnvironment` from `remoteEnvironment.js`. The preparation tests run against real temporary workspaces with a stub `pnpm` binary on `PATH` that records its invocations to a JSONL file. Oracles assert that non-contract source changes select the cached prepare script while Solidity inputs (`contracts/`, `hardhat.config.ts`, `package.json`) or stale preparation force the full script; that `buildWorkerEnvironment` forwards only an allowlist (`PATH`, `HOME`) and drops server secrets; that a missing native module triggers exactly one `pnpm rebuild` and then fails the preparation loudly, naming the module; and that linked repositories are installed and prepared in dependency order with the right lockfile flags (`--no-frozen-lockfile` vs `--frozen-lockfile` after `pnpm import`), no dangerous build or ignore-scripts flags, `HUSKY=0`, a shared `pnpm-store`, every child registered with the lease runtime, and human-readable stage callbacks. This is worker tooling under `scripts/`, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                       | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`distributed workspace preparation > reuses compiled contracts for non-contract source changes`](../../../../../../../test/scripts/e2eParallelWorkspacePreparation.test.ts#L27) (line 27)             | —      |
| [`distributed workspace preparation > recompiles when Solidity inputs change or preparation is stale`](../../../../../../../test/scripts/e2eParallelWorkspacePreparation.test.ts#L37) (line 37)        | —      |
| [`distributed workspace preparation > does not pass unrelated server secrets into uploaded code`](../../../../../../../test/scripts/e2eParallelWorkspacePreparation.test.ts#L59) (line 59)             | —      |
| [`distributed workspace preparation > rebuilds missing native modules once and fails the preparation loudly`](../../../../../../../test/scripts/e2eParallelWorkspacePreparation.test.ts#L69) (line 69) | —      |
| [`distributed workspace preparation > installs and prepares linked repositories in dependency order`](../../../../../../../test/scripts/e2eParallelWorkspacePreparation.test.ts#L134) (line 134)       | —      |
