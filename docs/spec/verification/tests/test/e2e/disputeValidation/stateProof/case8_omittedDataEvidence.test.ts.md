# test/e2e/disputeValidation/stateProof/case8_omittedDataEvidence.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case8_omittedDataEvidence.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case8_omittedDataEvidence.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

One end-to-end case for the no-data verdict rule. `lifecycle.start(3, 4)` and one finalized block
give a head that is final by everyone, so peer 0's self-removal dispute omits its auditing data.
The dispute is uploaded through `postTamperedDispute` (not marked malicious; peer 0's own
initiation is suppressed) with an earlier milestone prepended: the two stored blocks below the
first kept block with their confirmations removed, so the run links but misses the threshold. The
test confirms the premises on the chain: `verifyMilestones` answers invalid, `isStateProofLinked`
answers linked, and `isLastMilestoneFinalByEveryone` answers true. The oracles: auditors 1 and 2
commit the dispute, auditor 1's local `isCorrectLatestState` check runs and never answers false,
the window resolves, neither auditor stores a dispute fraud proof or sees a kill, and nobody is in
the on-chain slash set. The posted-data counterpart is out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                                                                            | Covers                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 8 (omitted-data evidence) > an omitted-data dispute with a linked earlier run missing the threshold and a last run final by everyone → no DisputeInvalidStateProof, no kill, the latest-state check still runs, it resolves, no honest slash`](../../../../../../../../test/e2e/disputeValidation/stateProof/case8_omittedDataEvidence.test.ts#L17) (line 17) | [`REQ-FP-7-4DD0D7.T1.P22`](../../../../../../specification/disputes/fraud-proofs.md#req-fp-7-4dd0d7.t1.p22) |
