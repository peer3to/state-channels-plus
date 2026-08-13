# test/e2e/E2E-FirstBlockTimestampGrace.test.ts — Test Report

> **Test file:** [test/e2e/E2E-FirstBlockTimestampGrace.test.ts](../../../../../../../test/e2e/E2E-FirstBlockTimestampGrace.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite verifies the `firstBlockGrace` rule — height 0 of a fork gets `evidenceTime` added to
its windows — end to end on real 2–3 peer sessions. It asserts the exact timeout arithmetic
(`getTimeoutWaitTimeSeconds` returns `p2pTime + agreementTime + chainFallbackTime` plus
`evidenceTime` only at height 0), then authors height 0 after the ordinary participant deadline
and proves every peer finalizes the same block with all three signatures, a timestamp above the
normal `genesis + p2pTime` cap but within `genesis + evidenceTime + p2pTime`, and no dispute.
A companion test proves height 1 gets no grace: authoring past the cap yields a block clamped to
exactly `previousBlock.timestamp + p2pTime` (the inclusive boundary), still finalized by all
peers. The last test drives the timeout side through `lifecycle.timeoutSetup`: one second before
the grace deadline no peer initiates a dispute, after it the two waiting peers initiate and the
timed-out peer does not. Oracles are decoded genesis snapshots and block bundles fetched over the
control RPC plus dispute event spies. On-chain adjudication of `InvalidTimestamp` proofs and
non-grace timeout scheduling are out of scope. No test IDs are assigned: the time-model and
StateManager-timeout permutations bundle scenarios (honest-skew bounds, every predecessor/slot
combination) beyond this suite, and the due-time boundary obligation is left to the dedicated
timeouts suite.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                         | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: First block timestamp grace > adds evidenceTime only to the height 0 participant timeout`](../../../../../../../test/e2e/E2E-FirstBlockTimestampGrace.test.ts#L22) (line 22)                      | —      |
| [`E2E: First block timestamp grace > authors height 0 after the old participant deadline and every peer finalizes it`](../../../../../../../test/e2e/E2E-FirstBlockTimestampGrace.test.ts#L38) (line 38) | —      |
| [`E2E: First block timestamp grace > caps height 1 without evidenceTime grace and every peer finalizes it`](../../../../../../../test/e2e/E2E-FirstBlockTimestampGrace.test.ts#L111) (line 111)          | —      |
| [`E2E: First block timestamp grace > does not time out height 0 inside the grace window and times out after it`](../../../../../../../test/e2e/E2E-FirstBlockTimestampGrace.test.ts#L170) (line 170)     | —      |
