# test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts — Test Report

> **Test file:** [test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts](../../../../../../../../../test/e2e/disputeValidation/stateProof/case1_inboundDivergence.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                                                                                                                                                  | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.1: auditingData.milestoneSnapshots[1].snapshotData.latestInboundMessageBlockHash = random > Case 1.1 → DisputeInvalidStateProof` (line 17)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.2: auditingData.milestoneSnapshots[1] left honest (M2 inbound hash valid, snapshot matches M2) > → dispute commits without DisputeInvalidStateProof` (line 56) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.3: auditingData.milestoneSnapshots[1] = milestoneSnapshots[2] (M2 row claims M3 snapshot, skip-ahead) > Case 1.3 → DisputeInvalidStateProof` (line 60)         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.4: auditingData.milestoneSnapshots[1] = milestoneSnapshots[0] (M2 row claims M1 snapshot, stay-back) > Case 1.4 → DisputeInvalidStateProof` (line 97)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `E2E: dispute validation / stateProof / Case 1 (M1/M2 inbound divergence) > Case 1.5: auditingData.milestoneSnapshots[1].snapshotData.participants omits pending joiner (M1 colluding on M2) > Case 1.5 → DisputeInvalidStateProof` (line 134)    | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
