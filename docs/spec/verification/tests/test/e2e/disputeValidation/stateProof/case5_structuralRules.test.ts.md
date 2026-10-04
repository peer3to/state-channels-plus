# test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One structural rule of the state-proof walk, judged by auditors through the mirrored canonical
logic. `preDisputeSetupCalldataPath` yields a proof with milestones, `stubConstructDispute` empties
`milestones[0].blockConfirmations` in peer 3's dispute (and marks peer 3 malicious), and peer 1's
double sign is the trigger. An empty milestone makes the walk invalid. Oracles: peer 3's dispute
initiates with auditing data, peer 0 observes `onDisputeKilled`, the honest peers store
`DisputeInvalidStateProof`, and the window resolves to a fork without the malicious peers.
Header-mismatch, replay-level and tail-structure tampers are out of scope (Case 4, the
milestone-content suite and Case 3).

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                             | Covers                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / structural rules > each milestone must have at least one blockConfirmation > stateProof.milestones[0].blockConfirmations = [] → DisputeInvalidStateProof`](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_structuralRules.test.ts#L6) (line 6) | [`REQ-SP-7-70EMAT.T1.P17`](../../../../../../specification/disputes/state-proofs.md#req-sp-7-70emat.t1.p17) |
