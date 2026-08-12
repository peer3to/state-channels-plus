# Data Availability — Verification

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

Candidate repository tests exist, but this subject has not yet completed declaration-level inspection and mapping.

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

| Permutation      | Behavior                                                                          | Implementation obligations                                                                                                     | Test status                        | Exact test evidence                                                                                                 | Runtime coverage                                                                                                                            | Missing coverage                                                        |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `INV-DA-1.T1.P1` | valid case and direct invalid/opposite                                            | Verify `INV-DA-1` through the matching implementation conformance row and the concrete obligations refined from `INV-DA-1.T1`. | Partial; permutation audit pending | Contract suites under [test/](../../../../../test)                                                                  | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-DA-1.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork       | Verify `INV-DA-1` through the matching implementation conformance row and the concrete obligations refined from `INV-DA-1.T1`. | Partial; permutation audit pending | Contract suites under [test/](../../../../../test)                                                                  | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-1.T1.P1` | valid case and direct invalid/opposite                                            | Verify `REQ-DA-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-1.T1`. | Partial; permutation audit pending | e2e recovery scenarios in [test/](../../../../../test); no p2p-fully-unavailable reconstruction test — `none — gap` | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-1.T1.P2` | malformed and adversarial input, partial failure, retry and recovery              | Verify `REQ-DA-1` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-1.T1`. | Partial; permutation audit pending | e2e recovery scenarios in [test/](../../../../../test); no p2p-fully-unavailable reconstruction test — `none — gap` | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-2.T1.P1` | valid case and direct invalid/opposite                                            | Verify `REQ-DA-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-2.T1`. | Partial; permutation audit pending | Fraud-proof timing tests under [test/](../../../../../test)                                                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-2.T1.P2` | before/at/after deadline and maximum honest skew                                  | Verify `REQ-DA-2` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-2.T1`. | Partial; permutation audit pending | Fraud-proof timing tests under [test/](../../../../../test)                                                         | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-3.T1.P1` | valid case and direct invalid/opposite                                            | Verify `REQ-DA-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-3.T1`. | Partial; permutation audit pending | Griefing e2e scenarios exist; cost-asymmetry accounting — `none — gap`                                              | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-3.T1.P2` | static review of every named alternative, omitted category and changed assumption | Verify `REQ-DA-3` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-3.T1`. | Partial; permutation audit pending | Griefing e2e scenarios exist; cost-asymmetry accounting — `none — gap`                                              | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-4.T1.P1` | valid case and direct invalid/opposite                                            | Verify `REQ-DA-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-4.T1`. | Partial; permutation audit pending | `none — gap` (process, no automated evidence)                                                                       | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `REQ-DA-4.T1.P2` | static review of every named alternative, omitted category and changed assumption | Verify `REQ-DA-4` through the matching implementation conformance row and the concrete obligations refined from `REQ-DA-4.T1`. | Partial; permutation audit pending | `none — gap` (process, no automated evidence)                                                                       | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |

## Implementation test traceability

This table judges every unit and internal system-integration permutation defined by the matching
implementation document. Evidence belongs here only after inspecting the exact test declaration.

| Implementation permutation                      | Level | Test status | Exact test evidence | Runtime coverage | Missing coverage                                      |
| ----------------------------------------------- | ----- | ----------- | ------------------- | ---------------- | ----------------------------------------------------- |
| _No numbered implementation permutations found_ | —     | Missing     | none — gap          | Not established  | Complete the matching implementation test plan first. |
