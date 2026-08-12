# Time Model — Verification

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

- **Objective timestamp rules, off-chain pipeline:**
  test/unit/ValidationService.test.ts
  (`validateTimeLogic` suite: first-block timestamp before genesis, bad timestamp without
  on-chain data, calldata-recovery rerun, still-invalid-after-recovery, post deadline exactly at
  the boundary).
- **Objective rules, on-chain:**
  test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol
  (`hasInvalidTimestamp` cases).
- **First-block grace end to end:**
  test/e2e/E2E-FirstBlockTimestampGrace.test.ts.
- **Timeout flows end to end:**
  test/e2e/E2E-Timeouts.test.ts,
  test/stateManager/StateManagerTimeout.test.ts.
- **Clock lifecycle:** test/Clock.test.ts — provider ownership,
  idempotent/concurrent init, re-init on provider replacement only. It does **not** test
  estimation accuracy.

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

| Permutation        | Behavior                                                                             | Implementation obligations                                                                                                         | Test status                        | Exact test evidence                                                                                                                                                                                                                                                                                                                                | Runtime coverage                                                                                                                            | Missing coverage                                                        |
| ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `REQ-TIME-1.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-TIME-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-1.T1`. | Partial; permutation audit pending | indirect via the timestamp suites in [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); estimation accuracy: none — gap                                                                                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-1.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary | Verify `REQ-TIME-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-1.T1`. | Partial; permutation audit pending | indirect via the timestamp suites in [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); estimation accuracy: none — gap                                                                                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-1.T1.P3` | before/at/after deadline and maximum honest skew                                     | Verify `REQ-TIME-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-1.T1`. | Partial; permutation audit pending | indirect via the timestamp suites in [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); estimation accuracy: none — gap                                                                                                                                                                                    | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-2.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-TIME-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-2.T1`. | Partial; permutation audit pending | [test/Clock.test.ts](../../../../../test/Clock.test.ts) (lifecycle only); skew-bound behavior: none — gap                                                                                                                                                                                                                                          | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-2.T1.P2` | correct/wrong/missing/duplicate/forged identity or signature and membership boundary | Verify `REQ-TIME-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-2.T1`. | Partial; permutation audit pending | [test/Clock.test.ts](../../../../../test/Clock.test.ts) (lifecycle only); skew-bound behavior: none — gap                                                                                                                                                                                                                                          | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-2.T1.P3` | before/at/after deadline and maximum honest skew                                     | Verify `REQ-TIME-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-2.T1`. | Partial; permutation audit pending | [test/Clock.test.ts](../../../../../test/Clock.test.ts) (lifecycle only); skew-bound behavior: none — gap                                                                                                                                                                                                                                          | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-3.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-TIME-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-3.T1`. | Missing                            | none — gap (defaults not empirically validated; see open question §3)                                                                                                                                                                                                                                                                              | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-3.T1.P2` | before/at/after deadline and maximum honest skew                                     | Verify `REQ-TIME-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-3.T1`. | Missing                            | none — gap (defaults not empirically validated; see open question §3)                                                                                                                                                                                                                                                                              | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-3.T1.P3` | zero, exact balance/boundary, one beyond, maximum value and conservation             | Verify `REQ-TIME-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-3.T1`. | Missing                            | none — gap (defaults not empirically validated; see open question §3)                                                                                                                                                                                                                                                                              | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-3.T1.P4` | static review of every named alternative, omitted category and changed assumption    | Verify `REQ-TIME-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-3.T1`. | Missing                            | none — gap (defaults not empirically validated; see open question §3)                                                                                                                                                                                                                                                                              | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-4.T1.P1` | valid case and direct invalid/opposite                                               | Verify `REQ-TIME-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-4.T1`. | Partial; permutation audit pending | [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol); [test/e2e/E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts); near-threshold disagreement: none — gap | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-4.T1.P2` | before/at/after deadline and maximum honest skew                                     | Verify `REQ-TIME-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-4.T1`. | Partial; permutation audit pending | [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol); [test/e2e/E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts); near-threshold disagreement: none — gap | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-4.T1.P3` | new/existing/removed/slashed participant and concurrent membership change            | Verify `REQ-TIME-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-4.T1`. | Partial; permutation audit pending | [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol); [test/e2e/E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts); near-threshold disagreement: none — gap | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-TIME-4.T1.P4` | malformed and adversarial input, partial failure, retry and recovery                 | Verify `REQ-TIME-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-TIME-4.T1`. | Partial; permutation audit pending | [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts); [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol); [test/e2e/E2E-Timeouts.test.ts](../../../../../test/e2e/E2E-Timeouts.test.ts); near-threshold disagreement: none — gap | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |

## Implementation test traceability

This table judges every unit and internal system-integration permutation defined by the matching
implementation document. Evidence belongs here only after inspecting the exact test declaration.

| Implementation permutation                      | Level | Test status | Exact test evidence | Runtime coverage | Missing coverage                                      |
| ----------------------------------------------- | ----- | ----------- | ------------------- | ---------------- | ----------------------------------------------------- |
| _No numbered implementation permutations found_ | —     | Missing     | none — gap          | Not established  | Complete the matching implementation test plan first. |
