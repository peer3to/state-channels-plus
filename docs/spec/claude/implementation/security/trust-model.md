# Trust Model — Implementation

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
listed in the conformance table. The principal trust model mechanisms are implemented
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

**Current:** The implementation supports exactly one provider. Configuration exposes a single
`PROVIDER_URL` string ([src/utils/config.ts](../../../../../src/utils/config.ts#L1)), the event listener
subscribes through the single provider attached to the contract runner
([src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)), and the runtime
chain context derives its WebSocket connection from the same URL
([src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L1)).
There is no multi-provider redundancy, cross-checking, or failover — **gap**.

**Current:** No watchtower, delegate, or third-party monitoring implementation exists in this
repository — **gap**. The SDK assumes the participant's own client
([src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1),
[src/disputeManager](../../../../../src/disputeManager)) is online to observe and respond. An
integrator deploying version one MUST either keep every honest participant's client online through
every contest window or operate an external delegate running the same SDK on the participant's
behalf.

## Migrated concrete material

The P2P layer is a **full mesh**: every participant connects directly to every other participant
(src/P2PManager.ts broadcasts each RPC to all connections).
Messaging cost is therefore quadratic in the number of participants.

The dispute and fraud-proof system defends against the following without requiring participants to
trust one another. Enum sources:
contracts/V1/types/ProofTypes.sol.

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                                        | Specification IDs                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/AConsumerFacet.sol#L3)                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)                            | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1)                                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L3)                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3)                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L3)                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L3)                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol#L3)                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol#L3)                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [contracts/V1/types/ProofTypes.sol](../../../../../contracts/V1/types/ProofTypes.sol#L3)                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/Clock.ts](../../../../../src/Clock.ts#L1)                                                                                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/disputeManager/DisputeManager.ts](../../../../../src/disputeManager/DisputeManager.ts#L1)                                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/disputeManager/index.ts](../../../../../src/disputeManager/index.ts#L1)                                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/eventHandlers/EventHandler.ts](../../../../../src/eventHandlers/EventHandler.ts#L1)                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/events/EventBus.ts](../../../../../src/events/EventBus.ts#L62)                                                                                                                | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/AContractExecutor.ts](../../../../../src/evm/contractExecutor/AContractExecutor.ts#L1)                                                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/browser/ContractExecutorWorkerEntry.ts](../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerEntry.ts#L1)                               | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts](../../../../../src/evm/contractExecutor/browser/ContractExecutorWorkerRuntime.ts#L1)                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/ContractExecutor.ts](../../../../../src/evm/contractExecutor/ContractExecutor.ts#L1)                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/ContractExecutorFactory.ts](../../../../../src/evm/contractExecutor/ContractExecutorFactory.ts#L20)                                                      | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/index.ts](../../../../../src/evm/contractExecutor/index.ts#L1)                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts](../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerEntry.ts#L1)                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts](../../../../../src/evm/contractExecutor/node/ContractExecutorWorkerRuntime.ts#L1)                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/NoOpLogger.ts](../../../../../src/evm/contractExecutor/NoOpLogger.ts#L1)                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/types.ts](../../../../../src/evm/contractExecutor/types.ts#L1)                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/worker/ContractExecutorWorkerHostCore.ts](../../../../../src/evm/contractExecutor/worker/ContractExecutorWorkerHostCore.ts#L44)                          | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/worker/protocol.ts](../../../../../src/evm/contractExecutor/worker/protocol.ts#L17)                                                                      | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/contractExecutor/WorkerContractExecutor.ts](../../../../../src/evm/contractExecutor/WorkerContractExecutor.ts#L1)                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/EvmDiamondStateMachine.ts](../../../../../src/evm/EvmDiamondStateMachine.ts#L1)                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/node/workerResourceLimits.ts](../../../../../src/evm/node/workerResourceLimits.ts#L1)                                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/node/workerShutdown.ts](../../../../../src/evm/node/workerShutdown.ts#L1)                                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/node/workerStartupTiming.ts](../../../../../src/evm/node/workerStartupTiming.ts#L1)                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/P2pInstance.ts](../../../../../src/evm/P2pInstance.ts#L1)                                                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/browser/P2pRuntimeChannel.ts](../../../../../src/evm/p2pRuntime/browser/P2pRuntimeChannel.ts#L4)                                                               | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/browser/P2pRuntimeWorkerRuntime.ts](../../../../../src/evm/p2pRuntime/browser/P2pRuntimeWorkerRuntime.ts#L28)                                                  | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/chainSignerSerialization.ts](../../../../../src/evm/p2pRuntime/chainSignerSerialization.ts#L1)                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/ClientHostRpc.ts](../../../../../src/evm/p2pRuntime/ClientHostRpc.ts#L1)                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/host/EventForwarding.ts](../../../../../src/evm/p2pRuntime/host/EventForwarding.ts#L1)                                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/HostHandlerExecutionContext.ts](../../../../../src/evm/p2pRuntime/HostHandlerExecutionContext.ts#L1)                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/node/P2pRuntimeChannel.ts](../../../../../src/evm/p2pRuntime/node/P2pRuntimeChannel.ts#L1)                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/node/P2pRuntimeWorkerRuntime.ts](../../../../../src/evm/p2pRuntime/node/P2pRuntimeWorkerRuntime.ts#L1)                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/P2pRuntimeClient.ts](../../../../../src/evm/p2pRuntime/P2pRuntimeClient.ts#L1)                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/P2pRuntimeHost.ts](../../../../../src/evm/p2pRuntime/P2pRuntimeHost.ts#L5)                                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts#L1)                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/types.ts](../../../../../src/evm/p2pRuntime/types.ts#L2)                                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/worker/nodeGlobalsShim.ts](../../../../../src/evm/p2pRuntime/worker/nodeGlobalsShim.ts#L2)                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/worker/P2pRuntimeWorkerEntry.ts](../../../../../src/evm/p2pRuntime/worker/P2pRuntimeWorkerEntry.ts#L1)                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/worker/protocol.ts](../../../../../src/evm/p2pRuntime/worker/protocol.ts#L17)                                                                                  | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/p2pRuntime/worker/startP2pRuntimeWorker.ts](../../../../../src/evm/p2pRuntime/worker/startP2pRuntimeWorker.ts#L19)                                                        | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/evm/signer/HostNonceManager.ts](../../../../../src/evm/signer/HostNonceManager.ts#L16)                                                                                        | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/P2PManager.ts](../../../../../src/P2PManager.ts#L1)                                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/PeerProfile.ts](../../../../../src/PeerProfile.ts#L1)                                                                                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/ProfileManager.ts](../../../../../src/ProfileManager.ts#L1)                                                                                                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/ARpcMethods.ts](../../../../../src/rpc/ARpcMethods.ts#L1)                                                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/ARpcService.ts](../../../../../src/rpc/ARpcService.ts#L7)                                                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/guards/AGuard.ts](../../../../../src/rpc/guards/AGuard.ts#L1)                                                                                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/guards/HandshakeCompletedGuard.ts](../../../../../src/rpc/guards/HandshakeCompletedGuard.ts#L1)                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/guards/index.ts](../../../../../src/rpc/guards/index.ts#L1)                                                                                                               | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/guards/runGuards.ts](../../../../../src/rpc/guards/runGuards.ts#L1)                                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/index.ts](../../../../../src/rpc/index.ts#L4)                                                                                                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/MainRpcService.ts](../../../../../src/rpc/MainRpcService.ts#L1)                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/registry.ts](../../../../../src/rpc/registry.ts#L2)                                                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/RemoteRpcProxy.ts](../../../../../src/rpc/RemoteRpcProxy.ts#L1)                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/resolveCustomRpcManifest.ts](../../../../../src/rpc/resolveCustomRpcManifest.ts#L1)                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/Rpc.ts](../../../../../src/rpc/Rpc.ts#L38)                                                                                                                                | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/RpcHandleProxy.ts](../../../../../src/rpc/RpcHandleProxy.ts#L2)                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/RpcHandler.ts](../../../../../src/rpc/RpcHandler.ts#L36)                                                                                                                  | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/index.ts](../../../../../src/rpc/services/index.ts#L1)                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeRpcMethods.ts#L2)                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/initHandshake/InitHandshakeService.ts](../../../../../src/rpc/services/initHandshake/InitHandshakeService.ts#L2)                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts](../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedRpcMethods.ts#L1)                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/isForkDisputedService/IsForkDisputedService.ts](../../../../../src/rpc/services/isForkDisputedService/IsForkDisputedService.ts#L1)                               | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/joinChannel/JoinChannelRpcMethods.ts](../../../../../src/rpc/services/joinChannel/JoinChannelRpcMethods.ts#L1)                                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/joinChannel/JoinChannelService.ts](../../../../../src/rpc/services/joinChannel/JoinChannelService.ts#L2)                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationHelpers.ts#L1)             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationRpcMethods.ts#L3)       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts](../../../../../src/rpc/services/openChannelNegotiation/OpenChannelNegotiationService.ts#L5)             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/spectate/SpectateRpcMethods.ts](../../../../../src/rpc/services/spectate/SpectateRpcMethods.ts#L1)                                                               | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/spectate/SpectateService.ts](../../../../../src/rpc/services/spectate/SpectateService.ts#L1)                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts#L1)                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/stateTransition/StateTransitionService.ts](../../../../../src/rpc/services/stateTransition/StateTransitionService.ts#L1)                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts](../../../../../src/rpc/services/WebRTCSetup/connection/LocalWebRTCConnectionFactory.ts#L34)              | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCBridgeProtocol.ts#L1)                               | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionFactory.ts#L1)                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes.ts#L1)                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCMainThreadBridge.ts#L42)                          | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WebRTCProvider.ts#L1)                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts](../../../../../src/rpc/services/WebRTCSetup/connection/WorkerBridgeWebRTCConnectionFactory.ts#L1) | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupRpcMethods.ts#L1)                                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/rpc/services/WebRTCSetup/WebRTCSetupService.ts](../../../../../src/rpc/services/WebRTCSetup/WebRTCSetupService.ts#L1)                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)                                                                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/stateManager/BlockQueueManager.ts](../../../../../src/stateManager/BlockQueueManager.ts#L48)                                                                                  | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/stateManager/reduction/ReductionExecutor.ts](../../../../../src/stateManager/reduction/ReductionExecutor.ts#L69)                                                              | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/stateManager/StateManager.ts](../../../../../src/stateManager/StateManager.ts#L1)                                                                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/ATransport.ts](../../../../../src/transport/ATransport.ts#L23)                                                                                                      | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/BrowserLocalTransport.ts](../../../../../src/transport/BrowserLocalTransport.ts#L6)                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/HolepunchTransport.ts](../../../../../src/transport/HolepunchTransport.ts#L1)                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/index.ts](../../../../../src/transport/index.ts#L1)                                                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/LocalTransport.ts](../../../../../src/transport/LocalTransport.ts#L16)                                                                                              | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/LoopbackTransport.ts](../../../../../src/transport/LoopbackTransport.ts#L6)                                                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/TransportType.ts](../../../../../src/transport/TransportType.ts#L1)                                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/transport/WebRTCTransport.ts](../../../../../src/transport/WebRTCTransport.ts#L1)                                                                                             | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/utils/Codec.ts](../../../../../src/utils/Codec.ts#L1)                                                                                                                         | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/utils/config.ts](../../../../../src/utils/config.ts#L1)                                                                                                                       | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/utils/node/LocalDiscoveryServer.ts](../../../../../src/utils/node/LocalDiscoveryServer.ts#L5)                                                                                 | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/utils/ObjectChecks.ts](../../../../../src/utils/ObjectChecks.ts#L1)                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/HolepunchRelay.ts](../../../../../src/HolepunchRelay.ts#L1)                                                                                                                   | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/IOnMessage.ts](../../../../../src/IOnMessage.ts#L1)                                                                                                                           | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |
| [src/P2pEventHooks.ts](../../../../../src/P2pEventHooks.ts#L1)                                                                                                                     | `INV-TRUST-1`, `REQ-TRUST-1`, `REQ-TRUST-2`, `REQ-TRUST-3`, `REQ-TRUST-4`, `REQ-TRUST-5`, `REQ-TRUST-6` |

### Supporting implementation analyses

- [architecture/sdk/architecture.md](../architecture/sdk/architecture.md)
- [architecture/sdk/runtime-and-concurrency.md](../architecture/sdk/runtime-and-concurrency.md)
- [architecture/sdk/rpc/README.md](../architecture/sdk/rpc/README.md)
- [architecture/sdk/rpc/handshake.md](../architecture/sdk/rpc/handshake.md)
- [architecture/sdk/rpc/webrtc-setup.md](../architecture/sdk/rpc/webrtc-setup.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status                      | Source evidence                                                                                                                                                                                                                     | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                           | Gap / divergence                                                                   |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `INV-TRUST-1`           | Implemented; engineer verification pending | [contracts/V1/StateChannelDiamondProxy](../../../../../contracts/V1/StateChannelDiamondProxy) (dispute + fraud-proof facets)                                                                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-TRUST-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-TRUST-1`           | Implemented; engineer verification pending | Fraud-proof and dispute facets consume signed artifacts and chain state only                                                                                                                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-TRUST-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-TRUST-2`           | Implemented; engineer verification pending | [src/utils/config.ts](../../../../../src/utils/config.ts#L1) (single `PROVIDER_URL`), [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)                                                        | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-TRUST-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-TRUST-3`           | Implemented; engineer verification pending | Protocol-wide design property                                                                                                                                                                                                       | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-TRUST-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-TRUST-4`           | Partial or divergent                       | `none — gap` (no watchtower implementation in repo)                                                                                                                                                                                 | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-TRUST-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-TRUST-5`           | Implemented; engineer verification pending | [src/P2PManager.ts](../../../../../src/P2PManager.ts#L1)                                                                                                                                                                            | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-TRUST-5.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-TRUST-6`           | Implemented; engineer verification pending | [src/rpc/services/initHandshake](../../../../../src/rpc/services/initHandshake) (domain-tagged challenge only; no identity/session binding) — see [../sdk/rpc/handshake.md](../../implementation/architecture/sdk/rpc/handshake.md) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-TRUST-6.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
