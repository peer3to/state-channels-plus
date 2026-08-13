# Disputes — Implementation

> **Specification subject:** [specification/disputes/disputes.md](../../../specification/disputes/disputes.md)

> **Agent authoring status:** Current implementation analysis assembled; source ownership and conclusions require engineer verification.
> **Engineer verification:** Pending.

## Contents

- [Implementation overview](#implementation-overview)
    - [Specification adherence](#specification-adherence)
    - [Specification contradiction](#specification-contradiction)
    - [Missing](#missing)
- [Assumptions and constraints](#assumptions-and-constraints)
- [System design](#system-design)
- [System integration test plan](#system-integration-test-plan)
- [Source inventory](#source-inventory)
- [Conformance traceability](#conformance-traceability)

## Implementation overview

**Status:** Partial; engineer verification pending.

### Specification adherence

The repository contains concrete source evidence for the specification requirements and invariants
listed in the conformance table. The principal disputes mechanisms are implemented
through the source boundaries described below, but their source ownership, edge cases, and test
coverage have not yet received the complete file-by-file engineer audit required for a conformance
claim.

### Specification contradiction

Known current-versus-intended divergences are recorded in [System design](#system-design) and in the
`Gap / divergence` column of [Conformance traceability](#conformance-traceability). The audit is not
yet complete enough to claim that list is exhaustive. **Required resolution:** classify every
recorded divergence as a defect, an approved implementation choice, or an open design decision, then
fix or approve it before marking the subject conformant.

### Missing

- Source ownership has not yet been reduced to one detailed report per inventoried file.
  **Required resolution:** audit every inventory row, remove unrelated ownership, and add its source
  report with exact specification IDs, design decisions, assumptions, constraints, and unit-test
  obligations.
- System integration cases have not yet been assigned stable `INTEGRATION-TEST-*` permutations.
  **Required resolution:** replace the provisional plan below with exhaustive, independently
  coverable integration cases and oracles.
- Exact test evidence remains in the matching verification migration queue. **Required resolution:**
  map every unit and integration permutation to inspected repository tests or an explicit gap.

## Assumptions and constraints

- The linked source entry points and data boundaries are the current implementation under review;
  comments or historical design prose are not treated as implementation evidence.
- Conformance depends on the assumptions and limits in the owning specification in addition to the
  implementation-specific conditions recorded in the system design and conformance table below.
- A source link establishes only that a mechanism exists. It does not prove all required behavior,
  failure atomicity, concurrency properties, or cross-runtime equivalence until the planned tests
  and engineer audit are complete.
- Current implementation status is limited to this repository revision and becomes stale when any
  mapped specification, source boundary, or verification evidence changes.

## System design

### 4.2 Evidence and kill period (Current semantics)

Both periods use the single `evidenceTime` configuration value
(`getEvidenceTime`, [reference/configuration.md](../operations/configuration.md)):

- **Evidence period** — from window creation; bounds _new dispute submissions_.
- **Kill period** — from the last accepted submission; bounds _challenges to committed disputes_
  and gates reduction. `_isKillPeriodExpired`:
  `now >= lastEvidenceSubmissionTimestamp + evidenceTime`.

`Current:` while the kill period is running, anyone may call `applyDisputeFraudProofs`
([`DisputeFraudProofFacet`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L15))
against committed disputes. Per proof:

- Proof **valid** (handler returns the claimed offender — for every current handler that is the
  dispute's disputer): the dispute commitment is removed from the window and the disputer is added
  to the on-chain slash set (`killDispute` → `DisputeKilled`) (`REQ-DIS-3`).
- Proof **invalid**: the submitter (`msg.sender`) is added to the slash set — but only when the
  submitter is itself dispute-eligible.
- A dispute that is no longer committed (already killed, or never uploaded) is skipped as a no-op;
  an expired kill period reverts the batch (`RaceConditionDisputeKillPeriodExpired`).

`killDispute` on `DisputeVerificationFacet` is reachable only through the
`applyDisputeFraudProofs` delegatecall — the proxy does not expose it as an external entry point
([`StateChannelManagerProxy`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L19)).

**Open question:** the intended kill-period rule needs engineer confirmation (who is slashed on a
valid vs. invalid dispute fraud proof, whether an ineligible outsider submitting an invalid proof
should escape penalty, and the exact conditions under which a kill is allowed). The behavior above
is recorded as observed implementation, not settled intent. See also
[fraud-proofs.md §5](./fraud-proofs.md) for the mirrored open question on block fraud proofs.

**Open question:** after all commitments in a window are killed, the window stays open
indefinitely and reduction is impossible until someone posts new evidence
(`reduceAndFinalize` requires a non-empty committed set). Whether an all-killed window should
close, expire, or auto-produce a trivial successor fork is unspecified.

## Migrated concrete material

Implementation entry points:
`DisputeManagerFacet`
(upload), `DisputeVerificationFacet`
(reduction, output computation, kill),
`DisputeFraudProofFacet`
(dispute policing), `StateSnapshotFacet`
(snapshot advancement), shared helpers in
`utils/DisputeUtils.sol`
and `StateChannelCommon`.
On-chain types: `DisputeTypes.sol`,
`ProofTypes.sol`. Off-chain drivers:
`src/disputeManager/DisputeManager.ts`,
`src/stateManager/DisputeValidationService.ts`,
`src/stateManager/reduction/`. The full off-chain
pipeline is specified in ../sdk/dispute-pipeline.md.

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                       | Specification IDs                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [contracts/V1/helpers/LibraryTestContract.sol](../../../../../../contracts/V1/helpers/LibraryTestContract.sol#L3)                                                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)        | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)               | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1)                                         | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                       | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L3)                             | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3)                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L3) | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L3)                       | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                             | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol#L3)                     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol#L3)                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelManagerEvents.sol](../../../../../../contracts/V1/StateChannelManagerEvents.sol#L3)                                                     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/StateChannelManagerInterface.sol](../../../../../../contracts/V1/StateChannelManagerInterface.sol#L3)                                               | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/types/DisputeFraudProofTypes.sol](../../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L3)                                               | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/types/DisputeTypes.sol](../../../../../../contracts/V1/types/DisputeTypes.sol#L6)                                                                   | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [contracts/V1/types/ProofTypes.sol](../../../../../../contracts/V1/types/ProofTypes.sol#L3)                                                                       | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/agreementManager/AgreementManager.ts](../../../../../../src/agreementManager/AgreementManager.ts#L1)                                                         | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/disputeManager/DisputeManager.ts](../../../../../../src/disputeManager/DisputeManager.ts#L1)                                                                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/eventHandlers/EventHandler.ts](../../../../../../src/eventHandlers/EventHandler.ts#L1)                                                                       | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L1)     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/rpc/services/isForkDisputedService/IsForkDisputedService.ts](../../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts#L1)           | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/DisputeValidationService.ts](../../../../../../src/stateManager/DisputeValidationService.ts#L33)                                                | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/EventSyncService.ts](../../../../../../src/stateManager/EventSyncService.ts#L1)                                                                 | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/reduction/index.ts](../../../../../../src/stateManager/reduction/index.ts#L1)                                                                   | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/reduction/ReductionComputationService.ts](../../../../../../src/stateManager/reduction/ReductionComputationService.ts#L24)                      | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/reduction/ReductionExecutor.ts](../../../../../../src/stateManager/reduction/ReductionExecutor.ts#L69)                                          | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/reduction/ReductionManager.ts](../../../../../../src/stateManager/reduction/ReductionManager.ts#L52)                                            | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts#L41)                        | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/StateManager.ts](../../../../../../src/stateManager/StateManager.ts#L1)                                                                         | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/utils/DisputeFraudProofService.ts](../../../../../../src/stateManager/utils/DisputeFraudProofService.ts#L8)                                     | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts#L1)             | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/stateManager/validationStrategy/DisputeValidationStrategy.ts](../../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts#L1)         | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/storage/DisputeFraudProofStorage.ts](../../../../../../src/storage/DisputeFraudProofStorage.ts#L1)                                                           | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/storage/DisputeStorage.ts](../../../../../../src/storage/DisputeStorage.ts#L1)                                                                               | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/storage/ForceExitStorage.ts](../../../../../../src/storage/ForceExitStorage.ts#L1)                                                                           | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/storage/FraudProofStorage.ts](../../../../../../src/storage/FraudProofStorage.ts#L1)                                                                         | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |
| [src/storage/TimeoutStorage.ts](../../../../../../src/storage/TimeoutStorage.ts#L1)                                                                               | `REQ-DIS-1`, `REQ-DIS-2`, `REQ-DIS-3`, `REQ-DIS-4`, `INV-DIS-5`, `REQ-DIS-6`, `INV-DIS-7`, `INV-DIS-8`, `REQ-DIS-9`, `REQ-DIS-10` |

### Supporting implementation analyses

- [architecture/sdk/dispute-pipeline.md](../architecture/sdk/dispute-pipeline.md)
- [architecture/sdk/rpc/is-fork-disputed.md](../architecture/sdk/rpc/is-fork-disputed.md)
- [architecture/contracts/manager-and-facets.md](../architecture/contracts/manager-and-facets.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status | Source evidence                                                                                                                                                                                                                                                                                                                                                                                               | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                          | Gap / divergence |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `REQ-DIS-1`             | Covered               | [`DisputeUtils._hasDisputeReason`](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L1), `InvalidDisputeReason` handler in [`DisputeFraudProofFacet`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L15)                                                                                                                                   | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `REQ-DIS-2`             | Covered               | [`DisputeManagerFacet._uploadDispute`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L10)                                                                                                                                                                                                                                                                                   | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `REQ-DIS-3`             | Covered               | [`DisputeManagerFacet._uploadDispute`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L10), [`DisputeFraudProofFacet.applyDisputeFraudProofs`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L17), [`DisputeVerificationFacet._killDispute`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L271) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `REQ-DIS-4`             | Covered               | [`_commitToDisputeReducedResult`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L1), [`DisputeUtils.areDisputesCommitted`](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L113), [`DisputeVerificationFacet.reduceAndFinalize`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L224)                   | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `INV-DIS-5`             | Covered               | [`DisputeVerificationFacet.reduce`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L61) (fold operators §5), [`_killDispute`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L271), [`DisputeUtils.areDisputesCommitted`](../../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L113)                    | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-DIS-5.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `REQ-DIS-6`             | Covered               | [`reduceOutputToSnapshotData`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L143), [`getGenesisTimestamp`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L68)                                                                                                                                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-6.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `INV-DIS-7`             | Covered               | [`reduceOutputToSnapshotData`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L143), `_calculateRemovals`                                                                                                                                                                                                                                                               | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-DIS-7.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `INV-DIS-8`             | Covered               | timeout fold in [`DisputeVerificationFacet.reduce`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L61)                                                                                                                                                                                                                                                                 | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-DIS-8.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `REQ-DIS-9`             | Covered               | [`StateSnapshotFacet.updateStateSnapshotFork`](../../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L9)                                                                                                                                                                                                                                                                             | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-9.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants.  | None.            |
| `REQ-DIS-10`            | Covered               | [`DisputeManagerFacet._disputeRaceConditionCheck`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L1), `Timeout*` handlers in [`DisputeFraudProofFacet`](../../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L15)                                                                                                                             | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DIS-10.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | None.            |
