# Protocol Lifecycle — Implementation

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
listed in the conformance table. The principal protocol lifecycle mechanisms are implemented
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

### Concrete lifecycle component mapping

- Opening is wired through `StateChannelManagerProxy.open`, threshold verification, the consumer
  deposit/genesis hooks, the chain signer, and the channel-open event handler.
- Continuous execution is owned by `StateManager`, `BlockQueueManager`, validation strategies,
  `AgreementManager`, `P2PManager`, and the configured transports; `postBlockCalldata` is the
  base-layer fallback.
- Dispute fallback is split across `DisputeManager`, `DisputeValidationService`, the reduction
  services, `DisputeManagerFacet`, `DisputeVerificationFacet`, `FraudProofFacet`, and
  `DisputeFraudProofFacet`.
- Settlement is assembled by `SnapshotUpdateService` and applied through `StateSnapshotFacet` and
  the consumer withdrawal hook. Benign races include another peer's snapshot landing first.

Current: [`MathStateMachine.leaveChannel`](../../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol#L112)
is exactly this — a normal transition that removes the caller and records an `ExitChannel`
outbound message. After a transition in which the local participant left, the SDK waits
`agreementTime` and then either posts the finalized snapshot (everyone signed) or opens a
self-removal dispute (`StateManager.startMaybeExitOnChain`).

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                                  | Specification IDs                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [contracts/V1/AStateMachine.sol](../../../../../contracts/V1/AStateMachine.sol#L3)                                                                                           | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/examples/MathStateMachine/MathStateMachine.sol](../../../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol#L16)                                | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol#L3)                                       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)                      | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)                             | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)                   | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                                   | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)                   | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                               | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                                           | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                               | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/agreementManager/AgreementManager.ts](../../../../../src/agreementManager/AgreementManager.ts#L1)                                                                       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/Clock.ts](../../../../../src/Clock.ts#L1)                                                                                                                               | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/disputeManager/DisputeManager.ts](../../../../../src/disputeManager/DisputeManager.ts#L1)                                                                               | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/eventHandlers/EventHandler.ts](../../../../../src/eventHandlers/EventHandler.ts#L1)                                                                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/evm/EvmDiamondStateMachine.ts](../../../../../src/evm/EvmDiamondStateMachine.ts#L1)                                                                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/evm/signer/ClientP2pSigner.ts](../../../../../src/evm/signer/ClientP2pSigner.ts#L24)                                                                                    | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/evm/signer/LocalP2pSigner.ts](../../../../../src/evm/signer/LocalP2pSigner.ts#L25)                                                                                      | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/P2PManager.ts](../../../../../src/P2PManager.ts#L1)                                                                                                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/MainRpcService.ts](../../../../../src/rpc/MainRpcService.ts#L1)                                                                                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/index.ts](../../../../../src/rpc/services/index.ts#L1)                                                                                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L2)                                           | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/joinChannel/JoinChannelRpcMethods.ts](../../../../../src/rpc/services/joinChannel/JoinChannelRpcMethods.ts#L1)                                             | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/joinChannel/JoinChannelService.ts](../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L2)                                                   | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1)       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L3) | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5)       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/spectate/SpectateRpcMethods.ts](../../../../../src/rpc/services/spectate/SpectateRpcMethods.ts#L1)                                                         | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/rpc/services/spectate/SpectateService.ts](../../../../../src/rpc/services/spectate/SpectateService.ts#L1)                                                               | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/BlockQueueManager.ts](../../../../../src/stateManager/BlockQueueManager.ts#L48)                                                                            | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/DisputeValidationService.ts](../../../../../src/stateManager/DisputeValidationService.ts#L33)                                                              | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/reduction/index.ts](../../../../../src/stateManager/reduction/index.ts#L1)                                                                                 | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/reduction/ReductionComputationService.ts](../../../../../src/stateManager/reduction/ReductionComputationService.ts#L24)                                    | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/reduction/ReductionExecutor.ts](../../../../../src/stateManager/reduction/ReductionExecutor.ts#L69)                                                        | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/reduction/ReductionManager.ts](../../../../../src/stateManager/reduction/ReductionManager.ts#L52)                                                          | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts#L41)                                      | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/StateManager.ts](../../../../../src/stateManager/StateManager.ts#L1)                                                                                       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/ValidationService.ts](../../../../../src/stateManager/ValidationService.ts#L15)                                                                            | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/validationStrategy/AValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/AValidationStrategy.ts#L1)                                   | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts#L1)                           | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/validationStrategy/CalldataCommittedStrategy.ts](../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts#L1)                       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/validationStrategy/DisputeValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts#L1)                       | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts#L229)               | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/storage/ForceJoinStorage.ts](../../../../../src/storage/ForceJoinStorage.ts#L1)                                                                                         | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/types/spectate.ts](../../../../../src/types/spectate.ts#L1)                                                                                                             | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [src/types/time.ts](../../../../../src/types/time.ts#L1)                                                                                                                     | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/common/DoubleLinkedList.sol](../../../../../contracts/common/DoubleLinkedList.sol#L2)                                                                             | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |
| [contracts/test/SimpleNumberStorage.sol](../../../../../contracts/test/SimpleNumberStorage.sol#L1)                                                                           | `REQ-LIF-1`, `REQ-LIF-2`, `REQ-LIF-3`, `REQ-LIF-4`, `INV-LIF-5`, `REQ-LIF-6` |

### Supporting implementation analyses

- [architecture/sdk/rpc/open-channel-negotiation.md](../architecture/sdk/rpc/open-channel-negotiation.md)
- [architecture/sdk/rpc/join-channel.md](../architecture/sdk/rpc/join-channel.md)
- [architecture/sdk/rpc/spectate.md](../architecture/sdk/rpc/spectate.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status                      | Source evidence                                                                                                                                                                                                                                                                                                               | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                         | Gap / divergence                                                                   |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `REQ-LIF-1`             | Implemented; engineer verification pending | [StateChannelManagerProxy.open](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L105); [StateSnapshotFacet](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L8)                                                                                                 | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-LIF-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-LIF-2`             | Implemented; engineer verification pending | [StateSnapshotFacet.updateStateSnapshotSameFork / updateStateSnapshotFork](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L42)                                                                                                                                                                   | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-LIF-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-LIF-3`             | Implemented; engineer verification pending | [AStateMachine.getOutboundMessages / \_addExitChannel](../../../../../contracts/V1/AStateMachine.sol#L35); [StateManager.startMaybeExitOnChain](../../../../../src/stateManager/StateManager.ts#L2385)                                                                                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-LIF-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-LIF-4`             | Implemented; engineer verification pending | [DisputeManagerFacet.\_uploadDispute](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L1); [DisputeVerificationFacet.reduce / reduceAndFinalize](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L61)                                                          | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-LIF-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-LIF-5`             | Implemented; engineer verification pending | [StateSnapshotFacet.\_applyOutboundMessageBlocks](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L1) (`CantWithdrawMoreThanDeposits`)                                                                                                                                                            | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-LIF-5.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-LIF-6`             | Implemented; engineer verification pending | [StateChannelManagerProxy](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L19) constructor; [StateManager.getTimeoutWaitTimeSeconds](../../../../../src/stateManager/StateManager.ts#L650); [DisputeUtils](../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L1) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-LIF-6.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
