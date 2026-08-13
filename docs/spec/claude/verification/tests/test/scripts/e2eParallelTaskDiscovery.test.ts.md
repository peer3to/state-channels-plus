# test/scripts/e2eParallelTaskDiscovery.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelTaskDiscovery.test.ts](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite unit-tests `discoverTasks` from `scripts/e2e-parallel/shared/taskDiscovery.js` and the wire codec `toWireTask`/`fromWireTask` from `scripts/e2e-parallel/distributed/taskWire.js` against synthetic test trees written into temporary directories. Oracles assert that task paths round-trip through project-relative wire form and that paths escaping the project (on encode) or the extracted workspace (on decode) throw; that discovery enumerates ordinary and E2E tests, marking only E2E tasks for shared infrastructure; that `--grep` matches the full nested Mocha title and each discovered task carries an anchored `--grep` argument; that a consumer-defined filename pattern (`**/*.spec.ts`) is honored while the default pattern ignores such files; and that dynamically generated `it` and `describe` titles (template substitution in loops) are enumerated into isolated per-title tasks before grep filtering. Actual Mocha execution of the discovered tasks is out of scope. The helpers are runner tooling under `scripts/`, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                 | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`parallel Mocha task discovery > round-trips task paths under the project and rejects escapes`](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts#L28) (line 28)               | —      |
| [`parallel Mocha task discovery > discovers ordinary and E2E tests and marks only E2E tasks for shared infra`](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts#L63) (line 63) | —      |
| [`parallel Mocha task discovery > applies --grep to the full nested Mocha title`](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts#L98) (line 98)                              | —      |
| [`parallel Mocha task discovery > supports a consumer-defined test filename pattern`](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts#L116) (line 116)                        | —      |
| [`parallel Mocha task discovery > enumerates substituted it titles into isolated tasks`](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts#L141) (line 141)                     | —      |
| [`parallel Mocha task discovery > enumerates dynamic describe titles before applying --grep`](../../../../../../../test/scripts/e2eParallelTaskDiscovery.test.ts#L169) (line 169)                | —      |
