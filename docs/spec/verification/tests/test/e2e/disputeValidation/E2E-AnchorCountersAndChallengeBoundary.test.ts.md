# E2E-AnchorCountersAndChallengeBoundary.test.ts

Test file: [test/e2e/disputeValidation/E2E-AnchorCountersAndChallengeBoundary.test.ts](../../../../../../../test/e2e/disputeValidation/E2E-AnchorCountersAndChallengeBoundary.test.ts)

## Overview

Exercises below-anchor counters and block challenge boundaries with real disputes. Cases check exact eligible targets, rejected challenger controls and resulting slashes.

Anchored-tail staging waits for block 2 finality, then overlaps snapshot publication with peer isolation followed by authoring blocks 3 and 4. The absent peer prevents tail finality, so publication still pins block 2. The transaction receipt and all mirror observations settle before proof construction and auditing; exact heights, proof positions and protocol timing are unchanged.

## Tests

- `E02: block zero final, its snapshot posted, then a stale empty-proof genesis dispute uploaded → DisputeStateProofBelowOnChainAnchor kills it and only its submitter is slashed`: REQ-FP-7-4DD0D7.T5.P1, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P176
- `E02 ext: an auditor whose local mirror never applied the block-zero snapshot post kills the stale empty-proof genesis dispute from the chain's anchor`: REQ-FP-7-4DD0D7.T5.P2, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P177
- `E16: a pending joiner whose join landed after the anchor was posted uploads a proof ending below that anchor → the anchor alone kills it (DisputeStateProofBelowOnChainAnchor), only the joiner is slashed`: REQ-FP-7-4DD0D7.T5.P3, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P178
- `E17: correct blocks before, at and after the anchor → no block-specific counter, no kill, the submitter is not slashed`: REQ-FP-7-4DD0D7.T5.P4, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P179
- `E17: forged history before the anchor (a forged block 0, so a broken link at index 1) → no auditor challenges it, and the structure, invalid-transition and author challenges naming those positions are all rejected on chain: no kill, the challenger is slashed, the submitter is not`: REQ-FP-7-4DD0D7.T5.P5, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P180
- `E17: forged history into the anchor (a forged block 1, so a broken link at the anchor's index 2) → no auditor challenges it, and the structure, invalid-transition and author challenges naming block 1 and the anchor are all rejected on chain: no kill, the challenger is slashed, the submitter is not`: REQ-FP-7-4DD0D7.T5.P6, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P181
- `E17: invalid transition in a replayed block after the anchor → DisputeInvalidBlockInStateProofApplyFraudProof kills the dispute on chain, only the submitter is slashed`: REQ-FP-7-4DD0D7.T5.P7, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P182
- `E17: a block after the anchor signed by another key than its author's → DisputeInvalidBlockStructure kills the dispute on chain, neither the named author nor the signer is slashed`: REQ-FP-7-4DD0D7.T5.P8, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P183
- `E17: a block after the anchor authored by a non-participant → DisputeBlockAuthorNotParticipant kills the dispute on chain, only the submitter is slashed`: REQ-FP-7-4DD0D7.T5.P9, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P184
- `E17: a block after the anchor naming another fork → DisputeStateProofHeaderMismatch kills the dispute on chain, only the submitter is slashed`: REQ-FP-7-4DD0D7.T5.P10, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P185
- `E17 ext: a structure challenge naming a position outside the last milestone (index 5 of 5 blocks) is rejected on chain: no kill, the challenger is slashed, the submitter is not`: REQ-FP-7-4DD0D7.T5.P11, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P186
- `E18: genesis anchor, unfinalized block zero with a non-authentic author signature → DisputeInvalidBlockStructure at index 0 kills the dispute, only the submitter is slashed (not block zero's author)`: REQ-FP-7-4DD0D7.T5.P12, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P187
- `E18: genesis anchor, unfinalized block zero, correct blocks → no block-specific counter, no kill`: REQ-FP-7-4DD0D7.T5.P13, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P188
- `E18: genesis anchor, threshold-final block zero with a forged transaction re-signed by every participant → zero stays everyone-final and eligible: an invalid-transition challenge at index 0 kills the dispute on chain, a challenge at the ineligible index 2 is rejected; only the submitter and the rejected challenger are slashed`: REQ-FP-7-4DD0D7.T5.P14, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P189
- `E18: genesis anchor, threshold-final block zero, correct blocks → no block-specific counter, no kill`: REQ-FP-7-4DD0D7.T5.P15, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P190
- `E18: block zero's resulting snapshot as the anchor protects zero: a forged transaction in block zero gets no block-specific challenge, no kill, the submitter is not slashed`: REQ-FP-7-4DD0D7.T5.P16, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P191
- `E40: invalid transition in a block after the boundary issued by another participant → DisputeInvalidBlockInStateProofApplyFraudProof kills the dispute, the submitter is slashed and, by the separate block fraud proof against the block it issued, the issuer`: REQ-FP-7-4DD0D7.T5.P17, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P192
- `E40: the invalid block after the boundary, issued by another participant, carries every participant's signature (evidence that could prove its finality) → still eligible: DisputeInvalidBlockInStateProofApplyFraudProof kills the dispute, the submitter is slashed and, by the separate block fraud proof against the block it issued, the issuer`: REQ-FP-7-4DD0D7.T5.P18, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P193
- `E40: a correct block after the boundary issued by another participant, carrying every participant's signature → eligibility alone is no offense: no counter, no kill, nobody slashed`: REQ-FP-7-4DD0D7.T5.P19, UNIT-TEST-DISPUTE-FRAUD-PROOF-FACET-1-QK8HQ7.P194

The receipt-before-tail staging used in earlier repairs still idled the author during estimation/mining. Publication and tail authoring now overlap; the required anchor-before-audit barrier remains. The fixture comment was updated to state this ordering explicitly.
