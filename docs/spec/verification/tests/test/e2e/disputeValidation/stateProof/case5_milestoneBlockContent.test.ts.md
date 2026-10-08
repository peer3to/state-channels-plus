# case5_milestoneBlockContent.test.ts

Test file: [test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts](../../../../../../../../test/e2e/disputeValidation/stateProof/case5_milestoneBlockContent.test.ts)

## Overview

Three milestone-content cases through the full dispute pipeline. First,
`rewriteLastMilestoneBlockConfirmationInDispute` bumps the last milestone block's
`transactionCnt` by 5 and re-signs it with peer 2's key (marked colluding) before peer 0
submits: honest peers kill the dispute, peer 0 is slashed on-chain, a replacement dispute
commits (window commitments stay non-empty), the stored proof is
`DisputeInvalidBlockStructure`, and no peer observes a final dispute. Second, with posted
auditing data, `appendLastMilestoneSignedBlockInDispute` adds a structurally clean but
semantically invalid tail block that only suffix replay can catch; the stored proof is
`DisputeInvalidBlockInStateProofApplyFraudProof`. Third, the next writer's confirmation is kept
off the parent and the auditor drops its subscribed block-calldata event before scheduling. The
tail uses the real next writer and a timestamp outside the parent's local `p2pTime` window but
inside its mined-calldata window: the kill still lands, and the block's `onChainTimestamp`
afterwards equals the mined calldata block's timestamp, proving that replay recovered the
historical calldata from chain before judging. Reduction details and which
later dispute applies the underlying block fraud proof are deliberately not asserted.
After the permutation atomization the replay-only tail case carries the mirrored
apply-fraud-proof predicate and suffix-replay-check permutations. Two rejections stand:
`REQ-DISPUTE-PIPE-6-6FZB9M.T1.P4` wants first-wins race semantics the replacement assertion does
not check, and `UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P5` spans every staleness-sensitive
re-check, not only calldata recovery.

## Tests

- `transactionCnt += 5 without auditing data → DisputeLastMilestoneNotFinalAndNoAuditingData`: none
- `messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof`: none
- `still replays a structurally clean invalid-STF tail`: REQ-DISPUTE-PIPE-5-RZZB48.T1.P14, UNIT-TEST-DISPUTE-VALIDATION-SERVICE-1-XBCA09.P10, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P15
- `recovers missed block calldata during replay before killing the dispute`: REQ-DA-1-NVV85Z.T1.P6
