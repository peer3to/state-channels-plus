# Data Availability — Implementation

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
listed in the conformance table. The principal data availability mechanisms are implemented
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

## Migrated concrete material

- The caller submits a full `SignedBlock` plus a `maxTimestamp` race-condition guard
  (`block.timestamp <= maxTimestamp` or the call reverts).
- The contract persists only a single commitment,
  `keccak256(abi.encode(signedBlock, block.timestamp))`, keyed by
  `(channelId, msg.sender, forkId, transactionCnt)`. The full block travels as calldata and is
  recoverable from the transaction, not from contract storage.
- A commitment is **non-overwritable**: reposting for the same key reverts
  (`ErrorBlockCalldataAlreadyPosted`).
- `msg.sender` MUST be the block's author (`ErrorBlockCalldataMsgSenderNotBlockAuthor`).
- The block's signature is NOT verified at posting time. The sender takes responsibility for the
  data: if the posted `SignedBlock` is junk, a fraud proof can slash the sender by verifying the
  junk against the commitment. A non-participant sender is ignored by peers and simply pays fees.
- The `BlockCalldataPosted` event carries the full signed block and the posting timestamp;
  clients ingest it through the event pipeline
  (src/StateChannelEventListener.ts,
  src/stateManager/EventSyncService.ts).

The protocol defines four on-chain configured windows
(contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol,
defaults in seconds: `p2pTime = 15`, `agreementTime = 5`, `chainFallbackTime = 30`,
`evidenceTime = 30`; deployments configure their own values):

**Open question:** the exact intended relationship between `agreementTime` and `chainFallbackTime`
consumption in each SDK escalation path (which component waits which window before posting) is
implemented across
src/stateManager/StateManager.ts and
src/stateManager/ValidationService.ts but not
yet specified precisely; it must be reverse-engineered into
../sdk/block-confirmation-pipeline.md and confirmed by an
engineer.

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                                        | Specification IDs                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [contracts/V1/helpers/LibraryTestContract.sol](../../../../../contracts/V1/helpers/LibraryTestContract.sol#L3)                                                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)                            | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1)                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L3)                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3)                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L3)                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L3)                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol#L3)                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol#L3)                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelManagerEvents.sol](../../../../../contracts/V1/StateChannelManagerEvents.sol#L3)                                                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/StateChannelManagerInterface.sol](../../../../../contracts/V1/StateChannelManagerInterface.sol#L3)                                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/types/DisputeFraudProofTypes.sol](../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L3)                                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/types/DisputeTypes.sol](../../../../../contracts/V1/types/DisputeTypes.sol#L6)                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [contracts/V1/types/ProofTypes.sol](../../../../../contracts/V1/types/ProofTypes.sol#L3)                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/agreementManager/AgreementManager.ts](../../../../../src/agreementManager/AgreementManager.ts#L1)                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/Clock.ts](../../../../../src/Clock.ts#L1)                                                                                                                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/eventHandlers/EventHandler.ts](../../../../../src/eventHandlers/EventHandler.ts#L1)                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/events/EventBus.ts](../../../../../src/events/EventBus.ts#L62)                                                                                                                | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/Holepunch.ts](../../../../../src/Holepunch.ts#L1)                                                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/models/Block.ts](../../../../../src/models/Block.ts#L1)                                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/models/index.ts](../../../../../src/models/index.ts#L1)                                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/models/StateProof.ts](../../../../../src/models/StateProof.ts#L1)                                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/models/StateSnapshot.ts](../../../../../src/models/StateSnapshot.ts#L1)                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/P2PManager.ts](../../../../../src/P2PManager.ts#L1)                                                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/ProfileManager.ts](../../../../../src/ProfileManager.ts#L1)                                                                                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/ARpcMethods.ts](../../../../../src/rpc/ARpcMethods.ts#L1)                                                                                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/ARpcService.ts](../../../../../src/rpc/ARpcService.ts#L7)                                                                                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/guards/AGuard.ts](../../../../../src/rpc/guards/AGuard.ts#L1)                                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/guards/HandshakeCompletedGuard.ts](../../../../../src/rpc/guards/HandshakeCompletedGuard.ts#L1)                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/guards/index.ts](../../../../../src/rpc/guards/index.ts#L1)                                                                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/guards/runGuards.ts](../../../../../src/rpc/guards/runGuards.ts#L1)                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/index.ts](../../../../../src/rpc/index.ts#L4)                                                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/MainRpcService.ts](../../../../../src/rpc/MainRpcService.ts#L1)                                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/registry.ts](../../../../../src/rpc/registry.ts#L2)                                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/RemoteRpcProxy.ts](../../../../../src/rpc/RemoteRpcProxy.ts#L1)                                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/resolveCustomRpcManifest.ts](../../../../../src/rpc/resolveCustomRpcManifest.ts#L1)                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/Rpc.ts](../../../../../src/rpc/Rpc.ts#L38)                                                                                                                                | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/RpcHandleProxy.ts](../../../../../src/rpc/RpcHandleProxy.ts#L2)                                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/RpcHandler.ts](../../../../../src/rpc/RpcHandler.ts#L36)                                                                                                                  | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/index.ts](../../../../../src/rpc/services/index.ts#L1)                                                                                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts#L2)                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L2)                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L1)                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/isForkDisputedService/IsForkDisputedService.ts](../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts#L1)                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/joinChannel/JoinChannelRpcMethods.ts](../../../../../src/rpc/services/joinChannel/JoinChannelRpcMethods.ts#L1)                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/joinChannel/JoinChannelService.ts](../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L2)                                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1)             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L3)       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5)             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/spectate/SpectateRpcMethods.ts](../../../../../src/rpc/services/spectate/SpectateRpcMethods.ts#L1)                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/spectate/SpectateService.ts](../../../../../src/rpc/services/spectate/SpectateService.ts#L1)                                                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts#L1)                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/stateTransition/StateTransitionService.ts](../../../../../src/rpc/services/stateTransition/StateTransitionService.ts#L1)                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts](../../../../../src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts#L34)              | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts#L1)                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts#L1)                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts#L1)                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts#L42)                          | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts#L1)                                           | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts#L1) | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts#L1)                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/rpc/services/WebRTCSetup/WebRTCSetupService.ts](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts#L1)                                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/stateManager/EventSyncService.ts](../../../../../src/stateManager/EventSyncService.ts#L1)                                                                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/stateManager/StateManager.ts](../../../../../src/stateManager/StateManager.ts#L1)                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/stateManager/ValidationService.ts](../../../../../src/stateManager/ValidationService.ts#L15)                                                                                  | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/BlockCalldataStorage.ts](../../../../../src/storage/BlockCalldataStorage.ts#L1)                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/BlockStorage.ts](../../../../../src/storage/BlockStorage.ts#L1)                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/DisputeFraudProofStorage.ts](../../../../../src/storage/DisputeFraudProofStorage.ts#L1)                                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/DisputeStorage.ts](../../../../../src/storage/DisputeStorage.ts#L1)                                                                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/EventSyncStorage.ts](../../../../../src/storage/EventSyncStorage.ts#L1)                                                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/ForceExitStorage.ts](../../../../../src/storage/ForceExitStorage.ts#L1)                                                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/ForceJoinStorage.ts](../../../../../src/storage/ForceJoinStorage.ts#L1)                                                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/FraudProofStorage.ts](../../../../../src/storage/FraudProofStorage.ts#L1)                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/index.ts](../../../../../src/storage/index.ts#L1)                                                                                                                     | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/MessageBlockStorage.ts](../../../../../src/storage/MessageBlockStorage.ts#L74)                                                                                        | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/ParticipantSetChangeStorage.ts](../../../../../src/storage/ParticipantSetChangeStorage.ts#L1)                                                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/QueueStorage.ts](../../../../../src/storage/QueueStorage.ts#L1)                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/StateMachineStateStorage.ts](../../../../../src/storage/StateMachineStateStorage.ts#L1)                                                                               | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/StateSnapshotStorage.ts](../../../../../src/storage/StateSnapshotStorage.ts#L1)                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/Storage.ts](../../../../../src/storage/Storage.ts#L1)                                                                                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/storage/TimeoutStorage.ts](../../../../../src/storage/TimeoutStorage.ts#L1)                                                                                                   | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/ATransport.ts](../../../../../src/transport/ATransport.ts#L23)                                                                                                      | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/BrowserLocalTransport.ts](../../../../../src/transport/BrowserLocalTransport.ts#L6)                                                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/HolepunchTransport.ts](../../../../../src/transport/HolepunchTransport.ts#L1)                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/index.ts](../../../../../src/transport/index.ts#L1)                                                                                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/LocalTransport.ts](../../../../../src/transport/LocalTransport.ts#L16)                                                                                              | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/LoopbackTransport.ts](../../../../../src/transport/LoopbackTransport.ts#L6)                                                                                         | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/TransportType.ts](../../../../../src/transport/TransportType.ts#L1)                                                                                                 | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/transport/WebRTCTransport.ts](../../../../../src/transport/WebRTCTransport.ts#L1)                                                                                             | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |
| [src/utils/config.ts](../../../../../src/utils/config.ts#L1)                                                                                                                       | `INV-DA-1`, `REQ-DA-1`, `REQ-DA-2`, `REQ-DA-3`, `REQ-DA-4` |

### Supporting implementation analyses

- [architecture/contracts/manager-and-facets.md](../architecture/contracts/manager-and-facets.md)
- [architecture/sdk/components.md](../architecture/sdk/components.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status                      | Source evidence                                                                                                                                                                                                                                          | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                        | Gap / divergence                                                                   |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `INV-DA-1`              | Implemented; engineer verification pending | [`postBlockCalldata`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L78)                                                                                                                                             | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-DA-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-DA-1`              | Implemented; engineer verification pending | `postBlockCalldata` + `BlockCalldataPosted` event ingestion ([src/stateManager/EventSyncService.ts](../../../../../src/stateManager/EventSyncService.ts#L1))                                                                                             | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DA-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-DA-2`              | Implemented; engineer verification pending | [`FraudProofFacet._hasInvalidTimestamp`](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L274), [`DisputeFraudProofFacet._timeoutDeadline`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L1) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DA-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-DA-3`              | Implemented; engineer verification pending | Design property (this document)                                                                                                                                                                                                                          | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DA-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-DA-4`              | Implemented; engineer verification pending | Process requirement (this document + [governance.md](../../governance.md) change loop)                                                                                                                                                                   | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-DA-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
