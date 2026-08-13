# test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts) > **Status:** Authored — engineer verification pending.

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

The suite audits signedBlocks-only state proofs, where fork genesis is the implicit anchor:
`preDisputeSetupDisconnectedPeer` prepares a channel with peer 2 disconnected,
`stubConstructDispute` rewrites peer 3's honestly constructed dispute just before submission,
and `submitDoubleSignBlock(1)` gives peer 3 a real reason to escalate. The tampers break the
genesis link of block 0, the height rules (`transactionCnt != 0` at index 0, a skipped height
at the tail), inter-block `previousBlockHash` linkage, the author signature, the latest
block's `stateSnapshotHash`, its `messageBlocks` (forged inbound message), and author
membership (an outsider-authored tail block, with honest and fabricated snapshot hashes).
Oracles: the dispute initiates without auditing data, honest peers kill it
(`onDisputeKilled`) and store the exact expected proof type — `DisputeInvalidBlockStructure`
for structural and signature violations, `DisputeInvalidBlockInStateProofApplyFraudProof` for
replay-detected deviations, `DisputeBlockAuthorNotParticipant` for the outsider author — and
most cases then resolve the dispute window. The outsider case additionally asserts that no
overlapping proof type is stored by any auditor, so an invalid verdict yields exactly the one
identifying proof. Milestone-carrying proofs and upload-gate reverts are out of scope. Beyond
the assigned ID, the remaining candidate permutations (`REQ-SP-4`/`REQ-SP-7`,
`REQ-ENFPROOF-3`, `REQ-DISPUTE-PIPE-2`) bundle several corruption families per ID, which no
single test here covers in full.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                                                                                                                                                                                                                                           | Covers                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[0].previousBlockHash = random (wrong genesis anchor) > height 0 first block with wrong genesis link → DisputeInvalidBlockInStateProofApplyFraudProof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L18) (line 18)                        | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[0].transaction.header.transactionCnt != 0 > first signedBlock height is not 0 → DisputeInvalidBlockStructure`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L64) (line 64)                                                                | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash (stateSnapshotHash mismatch) > stateSnapshotHash = ZeroHash → DisputeInvalidBlockInStateProofApplyFraudProof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L101) (line 101)                | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[-1].encodedBlock.messageBlocks injected with forged inbound message > messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L142) (line 142) | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[1].previousBlockHash = random (inter-block linkage break) > signedBlocks[1].previousBlockHash = random → DisputeInvalidBlockStructure`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L206) (line 206)                                     | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof signed-block structural proof > invalid author signature → DisputeInvalidBlockStructure`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L249) (line 249)                                                                                                | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof signed-block structural proof > skipped height → DisputeInvalidBlockStructure`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L276) (line 276)                                                                                                          | —                                                                                                                     |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof block authored by a non-participant > valid outsider-authored block → dedicated dispute proof only`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L306) (line 306)                                                                                     | [`REQ-DISPUTE-PIPE-5.T1.P2`](../../../../../../specification/disputes/dispute-processing.md#req-dispute-pipe-5-t1-p2) |
| [`E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof block authored by a non-participant > outsider-authored block with fabricated snapshot hash → fallback transition proof`](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts#L359) (line 359)                                                                | —                                                                                                                     |
