# test/e2e/E2E-ByzantineErrorAttribution.test.ts — Test Report

> **Test file:** [test/e2e/E2E-ByzantineErrorAttribution.test.ts](../../../../../../test/e2e/E2E-ByzantineErrorAttribution.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two tests for the test session's detached-error attribution, not for a protocol component: a
stray rejected promise raised on a peer marked malicious is suppressed (no detached error is
recorded within the wait window), while the identical rejection from an honest peer must surface
through `expectFirstDetachedError`. Both run against a real three-peer channel so the error path
is the production host wiring, but the behavior under test is harness/session infrastructure —
the error-to-peer attribution every other e2e suite relies on to ignore expected byzantine
failures without hiding honest-peer bugs. There is no matching specification or implementation
permutation for this infrastructure, so no test IDs are assigned.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                          | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: Byzantine error attribution > suppresses a stray detached error originating on a malicious peer`](../../../../../../test/e2e/E2E-ByzantineErrorAttribution.test.ts#L6) (line 6)    | —      |
| [`E2E: Byzantine error attribution > does not suppress the same error when it comes from an honest peer`](../../../../../../test/e2e/E2E-ByzantineErrorAttribution.test.ts#L24) (line 24) | —      |
