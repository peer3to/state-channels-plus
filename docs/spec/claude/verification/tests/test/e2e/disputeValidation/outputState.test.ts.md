# test/e2e/disputeValidation/outputState.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/outputState.test.ts](../../../../../../../../test/e2e/disputeValidation/outputState.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The single test checks that the validator recomputes the post-reduction output commitment from
the verified state proof plus dispute input and rejects mismatches. Peer 2's `constructDispute` is
stubbed to overwrite `dispute.outputSnapshotDataHash` with `hash("0x42")`; peer 1's double-sign
block provokes the dispute. The oracles assert peer 2's dispute is initiated and committed without
auditing data, an honest peer fires `onDisputeKilled`, honest peers store a
`DisputeInvalidOutputState` dispute fraud proof, and the fork resolves via `resolveDisputeWait`.
The selfRemoval-flipped variant that fails through the same proof type lives in
`disputeInputFields/selfRemoval.test.ts`. The nearby spec permutations bundle valid and invalid
scenarios, so none is fully covered by this single test.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                      | Covers |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / outputState > dispute.outputSnapshotDataHash = random → DisputeInvalidOutputState`](../../../../../../../../test/e2e/disputeValidation/outputState.test.ts#L10) (line 10) | —      |
