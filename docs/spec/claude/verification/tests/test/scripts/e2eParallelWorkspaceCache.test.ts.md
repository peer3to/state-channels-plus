# test/scripts/e2eParallelWorkspaceCache.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelWorkspaceCache.test.ts](../../../../../../../test/scripts/e2eParallelWorkspaceCache.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests the worker-side workspace cache of the distributed runner (`scripts/e2e-parallel/distributed/workspaceCache.js`): `diffSourceFiles`, `inspectWorkspace`, `commitSourceManifest`, `markPrepared`, `removeDeletedFiles`, all against real temporary directories. Oracles assert that a manifest diff requests only changed files and tracks deletions; that source and preparation state persist outside a lease so a re-inspection after commit reports nothing changed and `prepared: true`; that a cached file whose on-disk contents drift from its committed SHA-256 is requested again; that a prepared-state file written under an older worker policy invalidates preparation (`prepared: false`, `preparationChanged: true`); and that a relative worker root is normalized to an absolute cached workspace path keyed by workspace id. Bundle transfer and dependency installation are out of scope. The cache is test-orchestration tooling, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                       | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed workspace cache > requests only changed files and tracks deletions`](../../../../../../../test/scripts/e2eParallelWorkspaceCache.test.ts#L25) (line 25)                  | —      |
| [`distributed workspace cache > persists source and preparation state outside a lease`](../../../../../../../test/scripts/e2eParallelWorkspaceCache.test.ts#L32) (line 32)             | —      |
| [`distributed workspace cache > requests a cached source file again after its disk contents drift`](../../../../../../../test/scripts/e2eParallelWorkspaceCache.test.ts#L77) (line 77) | —      |
| [`distributed workspace cache > invalidates dependency preparation from an older worker policy`](../../../../../../../test/scripts/e2eParallelWorkspaceCache.test.ts#L115) (line 115)  | —      |
| [`distributed workspace cache > normalizes a relative worker root before building cached paths`](../../../../../../../test/scripts/e2eParallelWorkspaceCache.test.ts#L138) (line 138)  | —      |
