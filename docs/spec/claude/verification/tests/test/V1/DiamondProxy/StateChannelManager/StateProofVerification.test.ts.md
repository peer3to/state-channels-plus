# test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts — Test Report

> **Test file:** [test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts](../../../../../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                  | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `StateChannelManagerProxy.verifyStateProof > returns false when supplied auditing data does not match disputeAuditingDataHash` (line 25)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy.verifyStateProof > returns false instead of reverting when signedBlocks contain undecodable bytes` (line 40)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy.verifyStateProof > isCorrectLatestState returns false instead of reverting when latest block is undecodable` (line 52)  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy.verifyStateProof > verifyMilestones returns false instead of reverting when a milestone block is undecodable` (line 64) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `StateChannelManagerProxy.verifyStateProof > isMilestoneFinal returns false instead of reverting when a milestone block is undecodable` (line 78) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
