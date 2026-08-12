# History and Commitments — Implementation

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
listed in the conformance table. The principal history and commitments mechanisms are implemented
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

No implementation-specific notes were separated from the specification yet. Review the supporting analyses and record all mechanism choices, hidden assumptions, and divergences here.

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                    | Specification IDs                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [contracts/V1/helpers/LibraryTestContract.sol](../../../../../contracts/V1/helpers/LibraryTestContract.sol#L3)                                                 | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)        | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)               | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1)                                         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                       | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L3)                             | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3)                 | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L3) | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L3)                       | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                 | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                             | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol#L3)                     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                 | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol#L3)                 | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelManagerEvents.sol](../../../../../contracts/V1/StateChannelManagerEvents.sol#L3)                                                     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/StateChannelManagerInterface.sol](../../../../../contracts/V1/StateChannelManagerInterface.sol#L3)                                               | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/types/DataTypes.sol](../../../../../contracts/V1/types/DataTypes.sol#L5)                                                                         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/types/DisputeFraudProofTypes.sol](../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L3)                                               | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/types/DisputeTypes.sol](../../../../../contracts/V1/types/DisputeTypes.sol#L6)                                                                   | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [contracts/V1/types/ProofTypes.sol](../../../../../contracts/V1/types/ProofTypes.sol#L3)                                                                       | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/agreementManager/AgreementManager.ts](../../../../../src/agreementManager/AgreementManager.ts#L1)                                                         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/cache/index.ts](../../../../../src/cache/index.ts#L1)                                                                                                     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/cache/SignerRecoveryCache.ts](../../../../../src/cache/SignerRecoveryCache.ts#L15)                                                                        | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/eventHandlers/EventHandler.ts](../../../../../src/eventHandlers/EventHandler.ts#L1)                                                                       | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/models/Block.ts](../../../../../src/models/Block.ts#L1)                                                                                                   | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/models/index.ts](../../../../../src/models/index.ts#L1)                                                                                                   | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/models/StateProof.ts](../../../../../src/models/StateProof.ts#L1)                                                                                         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/models/StateSnapshot.ts](../../../../../src/models/StateSnapshot.ts#L1)                                                                                   | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/rpc/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts#L1)               | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/rpc/services/stateTransition/StateTransitionService.ts](../../../../../src/rpc/services/stateTransition/StateTransitionService.ts#L1)                     | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)                                                                         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/BlockQueueManager.ts](../../../../../src/stateManager/BlockQueueManager.ts#L48)                                                              | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/EventSyncService.ts](../../../../../src/stateManager/EventSyncService.ts#L1)                                                                 | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/StateManager.ts](../../../../../src/stateManager/StateManager.ts#L1)                                                                         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/utils/FraudProofService.ts](../../../../../src/stateManager/utils/FraudProofService.ts#L16)                                                  | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/ValidationService.ts](../../../../../src/stateManager/ValidationService.ts#L15)                                                              | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts#L1)             | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/validationStrategy/CalldataCommittedStrategy.ts](../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts#L1)         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/validationStrategy/DisputeValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts#L1)         | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts#L229) | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/storage/BlockStorage.ts](../../../../../src/storage/BlockStorage.ts#L1)                                                                                   | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/storage/QueueStorage.ts](../../../../../src/storage/QueueStorage.ts#L1)                                                                                   | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |
| [src/stateManager/index.ts](../../../../../src/stateManager/index.ts#L1)                                                                                       | `INV-HIST-1`, `INV-HIST-2`, `INV-HIST-3`, `INV-HIST-4` |

### Supporting implementation analyses

- [architecture/sdk/block-confirmation-pipeline.md](../architecture/sdk/block-confirmation-pipeline.md)
- [architecture/contracts/manager-and-facets.md](../architecture/contracts/manager-and-facets.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status                      | Source evidence                                                                                                                                                                                                         | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                          | Gap / divergence                                                                   |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `INV-HIST-1`            | Implemented; engineer verification pending | [DataTypes.sol](../../../../../contracts/V1/types/DataTypes.sol#L3) (`Block`, `StateSnapshot`, `SnapshotData`); [StateManager.createStateSnapshot / createBlock](../../../../../src/stateManager/StateManager.ts#L1118) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-HIST-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-HIST-2`            | Implemented; engineer verification pending | [StateManager.createBlock](../../../../../src/stateManager/StateManager.ts#L1417); [FraudProofFacet](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L10) (height-0 check)                     | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-HIST-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-HIST-3`            | Implemented; engineer verification pending | [StateManager.createStateSnapshot](../../../../../src/stateManager/StateManager.ts#L1118); [DataTypes.sol](../../../../../contracts/V1/types/DataTypes.sol#L3) (`SnapshotData`, `MessageBlock`)                         | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-HIST-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-HIST-4`            | Implemented; engineer verification pending | [StateChannelManagerProxy](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L19); [StateSnapshot.isGenesis](../../../../../src/models/StateSnapshot.ts#L106)                           | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-HIST-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
