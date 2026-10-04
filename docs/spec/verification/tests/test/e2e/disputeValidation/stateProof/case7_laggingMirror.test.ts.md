# test/e2e/disputeValidation/stateProof/case7_laggingMirror.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case7_laggingMirror.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case7_laggingMirror.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite checks that block allegations follow the submitted proof and the chain's on-chain snapshot,
never the auditor's local copy of it. In the first case, `stageAuditorBehindOnChainAnchor` lets peer 2
exit, so the chain holds a same-fork snapshot above height 0 that peer 1's local diamond never
applies. Peer 0 posts, through `postDisputeWithProof` with auditing data, a proof made of a prefix
milestone of stored blocks below that snapshot, the constructed milestones, and a block that
`craftProofBlock` forges above the head and appends to the last milestone. Peer 0's own kill is
suppressed. The oracles: the lagging auditor kills the dispute, its stored
`DisputeInvalidBlockInStateProofApplyFraudProof` decodes to the forged block's index in the
submitted last milestone, exactly one recorded kill succeeds, the disputer is slashed and the
auditor is not, and the window resolves.

The second case uses `stageExitAnchoredForkWithLaggingMirror` (four peers, one exits, the lagging
auditor drops the snapshot event) and `branchingRunBelowAnchor`: one milestone from block 0 whose
real blocks stop at the first block by another author, at or below the snapshot height, followed by
blocks the disputer forges up to one above the head; the forged block at the snapshot height commits
the on-chain snapshot, and the posted finalized state is the on-chain snapshot's state. Dispute
initiation is suppressed on every peer, the disputer's own kill is suppressed, and each auditor's
kill is held until it has stored its allegation. The oracles: both auditors store a
`DisputeInvalidBlockInStateProofApplyFraudProof` whose run index is the first block above the
snapshot height, while the branch starts at or below it; after release the lagging auditor's kill
lands; the disputer is slashed and neither auditor is. Read failures and the local-first tiers
themselves are out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                            | Covers                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 7 (lagging mirror) > lagging auditor mirror applies proof for exact submitted milestone/block position`](../../../../../../../../test/e2e/disputeValidation/stateProof/case7_laggingMirror.test.ts#L28) (line 28)                                                                                             | [`REQ-SP-10-AM67R2.T1.P24`](../../../../../../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1.p24) |
| [`E2E: dispute validation / stateProof / Case 7 (lagging mirror) > a lagging mirror replays from the chain's tail start: both auditors allege the same first eligible block, the lagging auditor's kill lands and no honest auditor is slashed`](../../../../../../../../test/e2e/disputeValidation/stateProof/case7_laggingMirror.test.ts#L125) (line 125) | [`REQ-SP-10-AM67R2.T1.P25`](../../../../../../specification/disputes/state-proofs.md#req-sp-10-am67r2.t1.p25) |
