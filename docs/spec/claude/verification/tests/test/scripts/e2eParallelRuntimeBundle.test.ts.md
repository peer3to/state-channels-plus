# test/scripts/e2eParallelRuntimeBundle.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelRuntimeBundle.test.ts](../../../../../../../test/scripts/e2eParallelRuntimeBundle.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

This suite exercises the source-workspace bundling of the distributed runner end to end on real temporary git repositories: `buildRuntimeBundle`/`buildDeltaBundle` from `scripts/e2e-parallel/distributed/runtimeBundle.js` and `extractRuntimeBundle`/`assertCompatible` from `runtimeExtractor.js`. The first test builds a project with a `link:`-dependency repository, gitignored secrets (`.env`), logs, and `node_modules`; oracles assert the manifest's version, root project path, runner entry, repository list, and yarn-lock detection, that extraction reproduces linked-repo layout while excluding every gitignored path, and that delta bundles carry exactly the requested changed files (including the empty-delta case). The second test asserts `assertCompatible` rejects an unsupported manifest version and that extraction of a corrupted archive fails with a checksum error. Installation, preparation scripts, and network transfer are out of scope. The component is `scripts/` developer tooling, so no specification or implementation test-plan permutation applies to this file.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                      | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`distributed source workspace > preserves linked repository layout and excludes gitignored files`](../../../../../../../test/scripts/e2eParallelRuntimeBundle.test.ts#L22) (line 22) | —      |
| [`distributed source workspace > rejects unsupported manifests and archive checksum changes`](../../../../../../../test/scripts/e2eParallelRuntimeBundle.test.ts#L147) (line 147)     | —      |
