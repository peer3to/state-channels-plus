# test/harness/testTimeConfig.test.ts — Test Report

> **Test file:** [test/harness/testTimeConfig.test.ts](../../../../../../../test/harness/testTimeConfig.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite exercises the test-harness helper `test/harness/core/testTimeConfig.ts` directly — it
tests support code for other suites, not production sources under `src/`. It asserts that
`resolveTestTimeConfig()` returns the minimum-safe baseline (`p2pTime: 2`, `agreementTime: 3`,
`chainFallbackTime: 3`, `evidenceTime: 6`), that partial overrides produce a copy without mutating
`MIN_TEST_TIME_CONFIG`, and that the derived-wait arithmetic is exact:
`participantTimeoutWaitMs` includes the first-block grace only at height 0, and
`evidencePeriodWaitMs`/`protocolEventTimeoutMs` produce the expected millisecond totals, including
the `withFirstBlockGrace` and `settlementMarginSeconds` options. Oracles are literal expected
values, pinning the timing contract that E2E suites rely on when waiting for protocol events.
Because this is harness support with no implementation source report, no test IDs from the pool
apply to it.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                       | Covers |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| [`test time config > resolves the minimum-safe baseline`](../../../../../../../test/harness/testTimeConfig.test.ts#L11) (line 11)                      | —      |
| [`test time config > applies partial overrides without mutating the baseline`](../../../../../../../test/harness/testTimeConfig.test.ts#L20) (line 20) | —      |
| [`test time config > includes first-block grace only at height zero`](../../../../../../../test/harness/testTimeConfig.test.ts#L28) (line 28)          | —      |
