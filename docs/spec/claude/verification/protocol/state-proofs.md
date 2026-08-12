# State Proofs & Milestones — Verification

> **Agent authoring status:** Current verification evidence assembled; completeness and classifications require engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Verification overview](#verification-overview)
    - [Specification-test adherence](#specification-test-adherence)
    - [Implementation-test adherence](#implementation-test-adherence)
    - [Contradictions](#contradictions)
    - [Missing](#missing)
- [Specification test traceability](#specification-test-traceability)
- [Implementation test traceability](#implementation-test-traceability)

## Verification overview

**Status:** Incomplete; candidate tests are known, but declaration-level setup and oracle review is
not complete for every specification and implementation permutation.

### Specification-test adherence

The existing candidate evidence is summarized below. These links are leads, not automatic credit; the traceability rows remain authoritative.

- **On-chain acceptance/rejection:**
  test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts
  exercises `verifyStateProof` on real SDK-built proofs.
- **Proof construction, including membership hops and height ceilings:**
  test/unit/AgreementManager.test.ts — proofs
  below/at join and leave heights, raised-threshold cases, signed-block fallback linkage verified
  on-chain, and proofs sampled across 10 produced blocks.
- **Membership-change disputes:**
  test/e2e/E2E-StaleMembershipDispute.test.ts,
  test/e2e/E2E-ForceJoinDispute.test.ts.
- **Proof-consuming sync paths:**
  test/e2e/E2E-Spectate.test.ts,
  test/e2e/E2E-SpectateStaleProofGuard.test.ts,
  test/e2e/E2E-SpectatorStateProofPersistence.test.ts.
- Gaps: no test for the intended (currently rejected) milestones+suffix shape; no adversarial
  test for oversized-proof gas exhaustion; removal-direction membership hops are covered more
  thinly than joins.

Only rows with an exact declaration link and a specific setup/oracle assessment receive credit.
Rows that still cite a whole file, a neighboring behavior, or “none — gap” remain partial or missing.

### Implementation-test adherence

The matching implementation document defines the source-owned unit permutations and internal system
integration permutations. Each is listed in the bottom matrix. Until a real test declaration is inspected
and its setup, stimulus, oracle, failure behavior, and runtime are recorded, that permutation remains missing.

### Contradictions

No test has yet been confirmed to assert behavior opposite to this subject's specification or implementation
plan. This is not a clean bill of health: broad legacy links have been downgraded to partial or missing where
they do not prove the named permutation.

### Missing

- Replace every whole-file or descriptive evidence link with the exact declaration that performs the setup,
  stimulus, and assertion.
- Classify every applicable component, contract, integration, end-to-end, browser/node, worker, and
  distributed runtime boundary.
- Add or identify tests for every row marked missing; split tests whose oracle cannot prove each credited
  permutation independently.
- Recheck misleading or merely adjacent tests instead of using their filenames as evidence.

## Specification test traceability

This table judges every neutral specification permutation against the real test body. A file-level or adjacent test is not complete evidence.

| Permutation      | Behavior                                                                             | Implementation obligations                                                                                                     | Test status                        | Exact test evidence                                                                                                                                                                                                      | Runtime coverage                                                                                                                            | Missing coverage                                                        |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `REQ-SP-1.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-SP-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-1.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts)                  | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-1.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork          | Verify `REQ-SP-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-1.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts)                  | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-2.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-SP-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-2.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts); mixed shape: none — gap (rejected by current code, §8)                                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-2.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork          | Verify `REQ-SP-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-2.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts); mixed shape: none — gap (rejected by current code, §8)                                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-3.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-SP-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-3.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts) join/leave cases, [E2E-StaleMembershipDispute.test.ts](../../../../../test/e2e/E2E-StaleMembershipDispute.test.ts)                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-3.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary | Verify `REQ-SP-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-3.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts) join/leave cases, [E2E-StaleMembershipDispute.test.ts](../../../../../test/e2e/E2E-StaleMembershipDispute.test.ts)                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-3.T1.P3` | new/existing/removed/slashed participant and concurrent membership change            | Verify `REQ-SP-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-3.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts) join/leave cases, [E2E-StaleMembershipDispute.test.ts](../../../../../test/e2e/E2E-StaleMembershipDispute.test.ts)                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-4.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-SP-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-4.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts) fallback case    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-4.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork          | Verify `REQ-SP-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-4.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts) fallback case    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-4.T1.P3` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary | Verify `REQ-SP-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-4.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts) fallback case    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-5.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-SP-5` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-5.T1`. | Partial; permutation audit pending | [E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts)                                                                                                                                             | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-5.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork          | Verify `REQ-SP-5` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-5.T1`. | Partial; permutation audit pending | [E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts)                                                                                                                                             | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-5.T1.P3` | malformed and adversarial input, partial failure, retry and recovery                 | Verify `REQ-SP-5` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-5.T1`. | Partial; permutation audit pending | [E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts)                                                                                                                                             | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-SP-6.T1.P1` | valid case and direct invalid/opposite                                               | Verify `INV-SP-6` through the matching implementation conformance row and the concrete obligations refined from `INV-SP-6.T1`. | Partial; permutation audit pending | [E2E-Fuzz-Dispute-MVP.test.ts](../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)                       | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-SP-6.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork          | Verify `INV-SP-6` through the matching implementation conformance row and the concrete obligations refined from `INV-SP-6.T1`. | Partial; permutation audit pending | [E2E-Fuzz-Dispute-MVP.test.ts](../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)                       | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-SP-6.T1.P3` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary | Verify `INV-SP-6` through the matching implementation conformance row and the concrete obligations refined from `INV-SP-6.T1`. | Partial; permutation audit pending | [E2E-Fuzz-Dispute-MVP.test.ts](../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)                       | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-SP-6.T1.P4` | new/existing/removed/slashed participant and concurrent membership change            | Verify `INV-SP-6` through the matching implementation conformance row and the concrete obligations refined from `INV-SP-6.T1`. | Partial; permutation audit pending | [E2E-Fuzz-Dispute-MVP.test.ts](../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)                       | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-7.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-SP-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-7.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [DisputeUtils.t.sol](../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-7.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork          | Verify `REQ-SP-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-7.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [DisputeUtils.t.sol](../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-SP-7.T1.P3` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary | Verify `REQ-SP-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-SP-7.T1`. | Partial; permutation audit pending | [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts), [DisputeUtils.t.sol](../../../../../test/V1/StateChannelDiamondProxy/utils/DisputeUtils.t.sol) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |

## Implementation test traceability

This table judges every unit and internal system-integration permutation defined by the matching
implementation document. Evidence belongs here only after inspecting the exact test declaration.

| Implementation permutation                      | Level | Test status | Exact test evidence | Runtime coverage | Missing coverage                                      |
| ----------------------------------------------- | ----- | ----------- | ------------------- | ---------------- | ----------------------------------------------------- |
| _No numbered implementation permutations found_ | —     | Missing     | none — gap          | Not established  | Complete the matching implementation test plan first. |
