# test/e2e/disputeValidation/stateProof/case9_historyWithoutRequiredSigner.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case9_historyWithoutRequiredSigner.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case9_historyWithoutRequiredSigner.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One case for the data obligation of a pending participant. `stageHistoryWithoutCharlie` lets
Alice and Bob author blocks 0-3 that both sign, then Charlie syncs with its block work held,
submits its join (the chain's required set now names Charlie), and Alice and Bob author one more
block that Charlie never signs. Alice's self-removal dispute is uploaded through
`postTamperedDispute` with `postedAuditingData = false`. The test confirms the proof shape
(`expectUnfinalTailStateProof`: a threshold-final first block, then the unsigned run) and that
`isLastMilestoneFinalByEveryone` answers false on the chain. The oracles: Charlie stores
`DisputeLastMilestoneNotFinalAndNoAuditingData`, observes the kill, and the slash set holds Alice
and not Charlie. Charlie's block work is released at the end.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                   | Covers                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 9 (history without a required signer) > longer alternate history without Charlie's signature cannot omit auditing calldata`](../../../../../../../../test/e2e/disputeValidation/stateProof/case9_historyWithoutRequiredSigner.test.ts#L14) (line 14) | [`REQ-FP-7-4DD0D7.T1.P23`](../../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7.t1.p23) |
