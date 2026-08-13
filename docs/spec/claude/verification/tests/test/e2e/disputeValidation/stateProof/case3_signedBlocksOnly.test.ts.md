# test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case3_signedBlocksOnly.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                                                                                                                   | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[0].previousBlockHash = random (wrong genesis anchor) > height 0 first block with wrong genesis link → DisputeInvalidBlockInStateProofApplyFraudProof` (line 18)                       | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[0].transaction.header.transactionCnt != 0 > first signedBlock height is not 0 → DisputeInvalidBlockStructure` (line 64)                                                               | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash (stateSnapshotHash mismatch) > stateSnapshotHash = ZeroHash → DisputeInvalidBlockInStateProofApplyFraudProof` (line 101)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[-1].encodedBlock.messageBlocks injected with forged inbound message > messageBlocks injected with forged inbound message → DisputeInvalidBlockInStateProofApplyFraudProof` (line 142) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof.signedBlocks[1].previousBlockHash = random (inter-block linkage break) > signedBlocks[1].previousBlockHash = random → DisputeInvalidBlockStructure` (line 206)                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof signed-block structural proof > invalid author signature → DisputeInvalidBlockStructure` (line 249)                                                                                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof signed-block structural proof > skipped height → DisputeInvalidBlockStructure` (line 276)                                                                                                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof block authored by a non-participant > valid outsider-authored block → dedicated dispute proof only` (line 306)                                                                                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 3 (signedBlocks-only) > stateProof block authored by a non-participant > outsider-authored block with fabricated snapshot hash → fallback transition proof` (line 359)                                                                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
