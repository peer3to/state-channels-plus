# test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Three milestone-content cases through the full dispute pipeline. First,
`rewriteLastMilestoneBlockConfirmationInDispute` bumps the last milestone block's
`transactionCnt` by 5 and re-signs it with peer 2's key (marked colluding) before peer 0
submits: honest peers kill the dispute, peer 0 is slashed on-chain, a replacement dispute
commits (window commitments stay non-empty), the stored proof is
`DisputeInvalidBlockStructure`, and no peer observes a final dispute. Second, with posted
auditing data, `appendLastMilestoneSignedBlockInDispute` adds a structurally clean but
semantically invalid tail block that only suffix replay can catch; the stored proof is
`DisputeInvalidBlockInStateProofApplyFraudProof`. Third, the auditor is made to miss a
block-calldata event before the same tail tamper: the kill still lands, and the block's
`onChainTimestamp` afterwards equals the mined calldata block's timestamp — proof that replay
recovered the historical calldata from chain before judging. Reduction details and which
later dispute applies the underlying block fraud proof are deliberately not asserted.
Candidate IDs were rejected as bundles: `REQ-DISPUTE-PIPE-6.T1.P4` wants first-wins race
semantics the replacement assertion does not check, and
`UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1.P5` spans every staleness-sensitive re-check, not
only calldata recovery.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                             | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`E2E: dispute validation / stateProof / milestone block content integrity > stateProof.milestones[-1].blockConfirmations[-1].header.transactionCnt > transactionCnt += 5 → DisputeInvalidBlockStructure`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts#L9) (line 9) | —      |
| [`E2E: dispute validation / stateProof / milestone block content integrity > posted auditing data > still replays a structurally clean invalid-STF tail`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts#L91) (line 91)                                                | —      |
| [`E2E: dispute validation / stateProof / milestone block content integrity > posted auditing data > recovers missed block calldata during replay before killing the dispute`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts#L147) (line 147)                          | —      |
