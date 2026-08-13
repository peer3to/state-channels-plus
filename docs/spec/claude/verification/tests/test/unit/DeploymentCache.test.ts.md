# test/unit/DeploymentCache.test.ts — Test Report

> **Test file:** [test/unit/DeploymentCache.test.ts](../../../../../../../test/unit/DeploymentCache.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises `resolveOrDeployShared` from the test-harness module
`test/harness/core/deploymentCache` — infrastructure that lets parallel test processes share one
deployed contract address through a marker file — against fresh `mkdtemp` cache directories with
stubbed `validate`/`deploy` callbacks and a real logger. The tests assert the cache contract at
the caller-visible level: a single deploy followed by cache hits for every later caller (deploy
counted once, `source` reported as `deployed` vs `cache`), concurrent first callers each receiving
a usable deployed value with the last write published for subsequent callers, redeployment when
the stored marker no longer validates (stale value replaced on disk), and a direct deploy when no
cache directory is configured. Oracles are the returned `{value, source}` pairs, deploy-call
counts, and the marker file's on-disk content. This is harness-only code with no implementation
source report under `docs/spec/claude/implementation/source/`, so there is no Exercises target and
no assignable test ID pool; protocol behavior is entirely out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                           | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`resolveOrDeployShared (component) > deploys once and serves every later caller from the marker`](../../../../../../../test/unit/DeploymentCache.test.ts#L16) (line 16)                   | —      |
| [`resolveOrDeployShared (component) > gives concurrent first callers a usable value each, then caches for the rest`](../../../../../../../test/unit/DeploymentCache.test.ts#L41) (line 41) | —      |
| [`resolveOrDeployShared (component) > redeploys when the stored value no longer validates`](../../../../../../../test/unit/DeploymentCache.test.ts#L76) (line 76)                          | —      |
| [`resolveOrDeployShared (component) > deploys directly when no cache dir is configured`](../../../../../../../test/unit/DeploymentCache.test.ts#L101) (line 101)                           | —      |
