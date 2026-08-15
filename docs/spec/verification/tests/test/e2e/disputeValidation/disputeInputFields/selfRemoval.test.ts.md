# test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Two tests cover `dispute.input.selfRemoval` from both sides. The valid case arms `forceExit` on
peer 1 so its dispute pipeline produces a genuine self-removal dispute, posted untampered: the
oracles assert exactly one commitment, no `onDisputeKilled` from anyone during a 4-second quiet
window, fork resolution among the remaining peers, a participant count of 2, and that every
remaining peer's participant list no longer contains the leaver's address. The invalid case posts
a dispute through `DisputeTampering.flipSelfRemovalWithoutOutputRecompute`, which flips the flag
and zeroes timeout/onChainSlashes without recomputing `outputSnapshotDataHash`; the on-chain
validator sees the output hash disagree with the flipped flag, so all peers fire
`onDisputeKilled`, honest peers store a `DisputeInvalidOutputState` proof, and the fork still
resolves. After the permutation atomization, the valid-case permutation of the dispute-input
requirement is a single scenario the accept-side test covers in full; the flipped variant is a
second instance of the output-correctness proof type, whose IDs live on `outputState.test.ts`.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                          | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / disputeInputFields / selfRemoval > dispute.input.selfRemoval = true; honest disputer voluntarily exits → dispute commits and disputer removed from participant set`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts#L10) (line 10) | —      |
| [`E2E: dispute validation / disputeInputFields / selfRemoval > dispute.input.selfRemoval flipped without recomputing outputSnapshotDataHash → DisputeInvalidOutputState`](../../../../../../../../test/e2e/disputeValidation/disputeInputFields/selfRemoval.test.ts#L74) (line 74)                        | —      |
