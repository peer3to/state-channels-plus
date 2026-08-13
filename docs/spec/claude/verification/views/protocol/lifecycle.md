# Protocol Lifecycle — Verification

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

- **Lifecycle end-to-end:** test/e2e/E2E-ParticipantLifecycle.test.ts
  drives open → execute → membership change → exit; the two-transaction happy path (open, then
  settlement snapshot) is the scenario skeleton of the e2e suites.
- **Settlement paths:** test/e2e/E2E-StateSnapshots.test.ts,
  test/stateManager/SnapshotUpdateService.test.ts
  (same-fork), test/e2e/E2E-FinalDispute.test.ts
  and test/e2e/E2E-ReductionManager.test.ts
  (successor-fork). Adversarial snapshot submissions:
  test/e2e/E2E-MaliciousUpdateSnapshot.test.ts.
- **Timing windows:** test/e2e/E2E-Timeouts.test.ts,
  test/e2e/E2E-FirstBlockTimestampGrace.test.ts,
  test/stateManager/StateManagerTimeout.test.ts.
- Gap: no test asserts the _minimality_ claim of REQ-LIF-1 directly (that exactly two
  transactions suffice in the best case); it is implied by the happy-path e2e flows.

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

| Permutation       | Behavior                                                                    | Implementation obligations                                                                                                       | Test status                        | Exact test evidence                                                                                                                                                                                                                                                                        | Runtime coverage                                                                                                                            | Missing coverage                                                        |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `REQ-LIF-1.T1.P1` | valid case and direct invalid/opposite                                      | Verify `REQ-LIF-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-1.T1`. | Partial; permutation audit pending | [E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts), [E2E-StateSnapshots.test.ts](../../../../../../test/e2e/E2E-StateSnapshots.test.ts); minimality itself: none — gap                                                                        | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-1.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `REQ-LIF-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-1.T1`. | Partial; permutation audit pending | [E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts), [E2E-StateSnapshots.test.ts](../../../../../../test/e2e/E2E-StateSnapshots.test.ts); minimality itself: none — gap                                                                        | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-1.T1.P3` | zero, exact balance/boundary, one beyond, maximum value and conservation    | Verify `REQ-LIF-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-1.T1`. | Partial; permutation audit pending | [E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts), [E2E-StateSnapshots.test.ts](../../../../../../test/e2e/E2E-StateSnapshots.test.ts); minimality itself: none — gap                                                                        | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-2.T1.P1` | valid case and direct invalid/opposite                                      | Verify `REQ-LIF-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-2.T1`. | Partial; permutation audit pending | [SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts), [E2E-FinalDispute.test.ts](../../../../../../test/e2e/E2E-FinalDispute.test.ts), [E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-2.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `REQ-LIF-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-2.T1`. | Partial; permutation audit pending | [SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts), [E2E-FinalDispute.test.ts](../../../../../../test/e2e/E2E-FinalDispute.test.ts), [E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-2.T1.P3` | before/at/after deadline and maximum honest skew                            | Verify `REQ-LIF-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-2.T1`. | Partial; permutation audit pending | [SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts), [E2E-FinalDispute.test.ts](../../../../../../test/e2e/E2E-FinalDispute.test.ts), [E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-2.T1.P4` | malformed and adversarial input, partial failure, retry and recovery        | Verify `REQ-LIF-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-2.T1`. | Partial; permutation audit pending | [SnapshotUpdateService.test.ts](../../../../../../test/stateManager/SnapshotUpdateService.test.ts), [E2E-FinalDispute.test.ts](../../../../../../test/e2e/E2E-FinalDispute.test.ts), [E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-3.T1.P1` | valid case and direct invalid/opposite                                      | Verify `REQ-LIF-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-3.T1`. | Partial; permutation audit pending | [E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts)                                                                                                                                                                                            | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-3.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `REQ-LIF-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-3.T1`. | Partial; permutation audit pending | [E2E-ParticipantLifecycle.test.ts](../../../../../../test/e2e/E2E-ParticipantLifecycle.test.ts)                                                                                                                                                                                            | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-4.T1.P1` | valid case and direct invalid/opposite                                      | Verify `REQ-LIF-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-4.T1`. | Partial; permutation audit pending | [E2E-DisputeManager.test.ts](../../../../../../test/e2e/E2E-DisputeManager.test.ts), [E2E-ReductionManager.test.ts](../../../../../../test/e2e/E2E-ReductionManager.test.ts)                                                                                                               | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-4.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `REQ-LIF-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-4.T1`. | Partial; permutation audit pending | [E2E-DisputeManager.test.ts](../../../../../../test/e2e/E2E-DisputeManager.test.ts), [E2E-ReductionManager.test.ts](../../../../../../test/e2e/E2E-ReductionManager.test.ts)                                                                                                               | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-4.T1.P3` | malformed and adversarial input, partial failure, retry and recovery        | Verify `REQ-LIF-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-4.T1`. | Partial; permutation audit pending | [E2E-DisputeManager.test.ts](../../../../../../test/e2e/E2E-DisputeManager.test.ts), [E2E-ReductionManager.test.ts](../../../../../../test/e2e/E2E-ReductionManager.test.ts)                                                                                                               | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-LIF-5.T1.P1` | valid case and direct invalid/opposite                                      | Verify `INV-LIF-5` through the matching implementation conformance row and the concrete obligations refined from `INV-LIF-5.T1`. | Partial; permutation audit pending | [E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts)                                                                                                                                                                                      | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-LIF-5.T1.P2` | zero, exact balance/boundary, one beyond, maximum value and conservation    | Verify `INV-LIF-5` through the matching implementation conformance row and the concrete obligations refined from `INV-LIF-5.T1`. | Partial; permutation audit pending | [E2E-MaliciousUpdateSnapshot.test.ts](../../../../../../test/e2e/E2E-MaliciousUpdateSnapshot.test.ts)                                                                                                                                                                                      | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-6.T1.P1` | valid case and direct invalid/opposite                                      | Verify `REQ-LIF-6` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-6.T1`. | Partial; permutation audit pending | [E2E-Timeouts.test.ts](../../../../../../test/e2e/E2E-Timeouts.test.ts), [StateManagerTimeout.test.ts](../../../../../../test/stateManager/StateManagerTimeout.test.ts)                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-LIF-6.T1.P2` | before/at/after deadline and maximum honest skew                            | Verify `REQ-LIF-6` through the matching implementation conformance row and the concrete obligations refined from `REQ-LIF-6.T1`. | Partial; permutation audit pending | [E2E-Timeouts.test.ts](../../../../../../test/e2e/E2E-Timeouts.test.ts), [StateManagerTimeout.test.ts](../../../../../../test/stateManager/StateManagerTimeout.test.ts)                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |

## Implementation test traceability

This table judges every unit and internal system-integration permutation defined by the matching
implementation document. Evidence belongs here only after inspecting the exact test declaration.

| Implementation permutation                      | Level | Test status | Exact test evidence | Runtime coverage | Missing coverage                                      |
| ----------------------------------------------- | ----- | ----------- | ------------------- | ---------------- | ----------------------------------------------------- |
| _No numbered implementation permutations found_ | —     | Missing     | none — gap          | Not established  | Complete the matching implementation test plan first. |
