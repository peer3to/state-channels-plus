# History and Commitments — Verification

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

- **Model round-trips and hashing.** Encode/decode round-trips and hash consistency for blocks
  and snapshots: test/models/Block.test.ts,
  test/models/StateSnapshot.test.ts.
- **Linkage and conflict handling.** Wrong `previousBlockHash`, non-linked conflicts, wrong
  genesis, double-signs at a taken height:
  test/unit/ValidationService.test.ts.
- **On-chain commitment checks.** Fraud-proof facet tests exercising block authenticity, genesis
  linkage, and forged-inbound detection:
  test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol.
- **Snapshot advancement end to end.**
  test/e2e/E2E-StateSnapshots.test.ts,
  test/e2e/E2E-MaliciousUpdateSnapshot.test.ts.
- Gap: no test asserts cross-implementation hash equality (SDK `StateSnapshot.hash` vs. on-chain
  `keccak256(abi.encode(...))`) over a corpus of randomized snapshots; equality is currently
  demonstrated only implicitly by e2e flows succeeding.

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

| Permutation        | Behavior                                                                    | Implementation obligations                                                                                                         | Test status                        | Exact test evidence                                                                                                                                                                                                                                | Runtime coverage                                                                                                                            | Missing coverage                                                        |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `INV-HIST-1.T1.P1` | valid case and direct invalid/opposite                                      | Verify `INV-HIST-1` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-1.T1`. | Partial; permutation audit pending | [test/models/StateSnapshot.test.ts](../../../../../test/models/StateSnapshot.test.ts) (hash/round-trip); e2e snapshot flows: [test/e2e/E2E-StateSnapshots.test.ts](../../../../../test/e2e/E2E-StateSnapshots.test.ts)                             | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-1.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `INV-HIST-1` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-1.T1`. | Partial; permutation audit pending | [test/models/StateSnapshot.test.ts](../../../../../test/models/StateSnapshot.test.ts) (hash/round-trip); e2e snapshot flows: [test/e2e/E2E-StateSnapshots.test.ts](../../../../../test/e2e/E2E-StateSnapshots.test.ts)                             | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-2.T1.P1` | valid case and direct invalid/opposite                                      | Verify `INV-HIST-2` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-2.T1`. | Partial; permutation audit pending | [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts) (linkage/genesis cases); [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-2.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `INV-HIST-2` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-2.T1`. | Partial; permutation audit pending | [test/unit/ValidationService.test.ts](../../../../../test/unit/ValidationService.test.ts) (linkage/genesis cases); [test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol](../../../../../test/V1/StateChannelDiamondProxy/FraudProofFacet.t.sol) | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-3.T1.P1` | valid case and direct invalid/opposite                                      | Verify `INV-HIST-3` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-3.T1`. | Partial; permutation audit pending | [test/e2e/E2E-StateSnapshots.test.ts](../../../../../test/e2e/E2E-StateSnapshots.test.ts); stream-processing detail: see [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)                                                | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-3.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `INV-HIST-3` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-3.T1`. | Partial; permutation audit pending | [test/e2e/E2E-StateSnapshots.test.ts](../../../../../test/e2e/E2E-StateSnapshots.test.ts); stream-processing detail: see [../protocol/cross-layer-messages.md](../protocol/cross-layer-messages.md)                                                | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-4.T1.P1` | valid case and direct invalid/opposite                                      | Verify `INV-HIST-4` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-4.T1`. | Partial; permutation audit pending | [test/models/StateSnapshot.test.ts](../../../../../test/models/StateSnapshot.test.ts); dispute successor-fork e2e: [test/e2e/E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts)                                           | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |
| `INV-HIST-4.T1.P2` | matching/mismatched commitment, predecessor/genesis, stale and foreign fork | Verify `INV-HIST-4` through the matching implementation conformance row and the concrete obligations refined from `INV-HIST-4.T1`. | Partial; permutation audit pending | [test/models/StateSnapshot.test.ts](../../../../../test/models/StateSnapshot.test.ts); dispute successor-fork e2e: [test/e2e/E2E-FinalDispute.test.ts](../../../../../test/e2e/E2E-FinalDispute.test.ts)                                           | Not fully classified; enumerate every required component, integration, base-layer, worker, browser/node, and distributed mode that applies. | Map exact test declarations and account for every required permutation. |

## Implementation test traceability

This table judges every unit and internal system-integration permutation defined by the matching
implementation document. Evidence belongs here only after inspecting the exact test declaration.

| Implementation permutation                      | Level | Test status | Exact test evidence | Runtime coverage | Missing coverage                                      |
| ----------------------------------------------- | ----- | ----------- | ------------------- | ---------------- | ----------------------------------------------------- |
| _No numbered implementation permutations found_ | —     | Missing     | none — gap          | Not established  | Complete the matching implementation test plan first. |
