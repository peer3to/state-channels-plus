# Finality — Verification

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

- **Virtual voting / milestone construction:**
  test/unit/AgreementManager.test.ts — proofs
  with fully-signed latest block (milestones-only), missing-signature fallback, membership-change
  hops, and on-chain verification of sampled proofs.
- **On-chain threshold rules:**
  test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts.
- **Equivocation:** double-sign detection in
  test/unit/ValidationService.test.ts; fraud
  proof application in
  test/e2e/E2E-FraudProofsBlockConfirmation.test.ts.
- **Missed slots and fallback:** test/e2e/E2E-Timeouts.test.ts,
  test/stateManager/StateManagerTimeout.test.ts.
- **Dispute route / carry-forward:**
  test/e2e/E2E-FinalDispute.test.ts,
  test/e2e/E2E-ReductionManager.test.ts,
  test/e2e/E2E-Fuzz-Dispute-MVP.test.ts.
- Gaps: no test currently isolates REQ-FIN-4's exact _N-consecutive-authors_ finalization bound,
  and partitioned-network adversarial scenarios for the fallback path are limited.

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

| Permutation       | Behavior                                                                              | Implementation obligations                                                                                                       | Test status                        | Exact test evidence                                                                                                                                                                                     | Runtime coverage                                                                                                                            | Missing coverage                                                        |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `REQ-FIN-1.T1.P1` | valid case and direct invalid/opposite                                                | Verify `REQ-FIN-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-1.T1`. | Partial; permutation audit pending | happy-path e2e suites ([E2E-StateTransition.test.ts](../../../../../test/e2e/E2E-StateTransition.test.ts)); delayed-signature scenario: none — gap                                                      | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-1.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary  | Verify `REQ-FIN-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-1.T1`. | Partial; permutation audit pending | happy-path e2e suites ([E2E-StateTransition.test.ts](../../../../../test/e2e/E2E-StateTransition.test.ts)); delayed-signature scenario: none — gap                                                      | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-FIN-2.T1.P1` | valid case and direct invalid/opposite                                                | Verify `INV-FIN-2` through the matching implementation conformance row and the concrete obligations refined from `INV-FIN-2.T1`. | Partial; permutation audit pending | [ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)           | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-FIN-2.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary  | Verify `INV-FIN-2` through the matching implementation conformance row and the concrete obligations refined from `INV-FIN-2.T1`. | Partial; permutation audit pending | [ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)           | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-FIN-2.T1.P3` | new/existing/removed/slashed participant and concurrent membership change             | Verify `INV-FIN-2` through the matching implementation conformance row and the concrete obligations refined from `INV-FIN-2.T1`. | Partial; permutation audit pending | [ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts), [E2E-FraudProofsBlockConfirmation.test.ts](../../../../../test/e2e/E2E-FraudProofsBlockConfirmation.test.ts)           | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-3.T1.P1` | valid case and direct invalid/opposite                                                | Verify `REQ-FIN-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-3.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-3.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork           | Verify `REQ-FIN-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-3.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-3.T1.P3` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary  | Verify `REQ-FIN-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-3.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-4.T1.P1` | valid case and direct invalid/opposite                                                | Verify `REQ-FIN-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-4.T1`. | Missing                            | none — gap (implied by milestone tests, not isolated)                                                                                                                                                   | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-4.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary  | Verify `REQ-FIN-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-4.T1`. | Missing                            | none — gap (implied by milestone tests, not isolated)                                                                                                                                                   | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-5.T1.P1` | valid case and direct invalid/opposite                                                | Verify `REQ-FIN-5` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-5.T1`. | Partial; permutation audit pending | [E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts)                                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-5.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary  | Verify `REQ-FIN-5` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-5.T1`. | Partial; permutation audit pending | [E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts)                                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-5.T1.P3` | before/at/after deadline and maximum honest skew                                      | Verify `REQ-FIN-5` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-5.T1`. | Partial; permutation audit pending | [E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts)                                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-6.T1.P1` | valid case and direct invalid/opposite                                                | Verify `REQ-FIN-6` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-6.T1`. | Partial; permutation audit pending | exercised implicitly by all e2e suites                                                                                                                                                                  | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-6.T1.P2` | zero/empty/no-op where meaningful, exact boundary, failure/recovery and relevant race | Verify `REQ-FIN-6` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-6.T1`. | Partial; permutation audit pending | exercised implicitly by all e2e suites                                                                                                                                                                  | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-7.T1.P1` | valid case and direct invalid/opposite                                                | Verify `REQ-FIN-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-7.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-7.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary  | Verify `REQ-FIN-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-7.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-7.T1.P3` | new/existing/removed/slashed participant and concurrent membership change             | Verify `REQ-FIN-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-7.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-FIN-7.T1.P4` | malformed and adversarial input, partial failure, retry and recovery                  | Verify `REQ-FIN-7` through the matching implementation conformance row and the concrete obligations refined from `REQ-FIN-7.T1`. | Partial; permutation audit pending | [AgreementManager.test.ts](../../../../../test/unit/AgreementManager.test.ts), [StateProofVerification.test.ts](../../../../../test/V1/DiamondProxy/StateChannelManager/StateProofVerification.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-FIN-8.T1.P1` | valid case and direct invalid/opposite                                                | Verify `INV-FIN-8` through the matching implementation conformance row and the concrete obligations refined from `INV-FIN-8.T1`. | Partial; permutation audit pending | [E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts), [E2E-Fuzz-Dispute-MVP.test.ts](../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts)                                      | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-FIN-8.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork           | Verify `INV-FIN-8` through the matching implementation conformance row and the concrete obligations refined from `INV-FIN-8.T1`. | Partial; permutation audit pending | [E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts), [E2E-Fuzz-Dispute-MVP.test.ts](../../../../../test/e2e/E2E-Fuzz-Dispute-MVP.test.ts)                                      | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |

## Implementation test traceability

This table judges every unit and internal system-integration permutation defined by the matching
implementation document. Evidence belongs here only after inspecting the exact test declaration.

| Implementation permutation                      | Level | Test status | Exact test evidence | Runtime coverage | Missing coverage                                      |
| ----------------------------------------------- | ----- | ----------- | ------------------- | ---------------- | ----------------------------------------------------- |
| _No numbered implementation permutations found_ | —     | Missing     | none — gap          | Not established  | Complete the matching implementation test plan first. |
