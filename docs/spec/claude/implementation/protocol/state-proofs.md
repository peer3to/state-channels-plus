# State Proofs & Milestones — Implementation

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
listed in the conformance table. The principal state proofs & milestones mechanisms are implemented
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

- The milestone-plus-suffix proof shape specified upstream is not fully implemented; the concrete
  proof representation and verifier path must be brought into conformance.

Current: [`StateProofFacet._isMilestoneFinalWithExpectedParticipants`](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L1)
implements exactly this — it walks the confirmations, enforces fork identity and hash linkage,
accumulates every authentic signer (author signatures and confirmation signatures) into one
threshold set, requires the set to cover all expected participants, and returns the **first**
block's `stateSnapshotHash` as the finalized snapshot of the anchor.
[`AgreementManager.tryBuildMilestone`](../../../../../src/agreementManager/AgreementManager.ts#L106) is
the off-chain constructor of the same object.

Current, on-chain: [`StateProofFacet.verifyMilestones`](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L114)
verifies K milestones against K milestone snapshots, rolling the threshold context forward: each
milestone's expected participants are
`previousSnapshot.participants ∪ resultingSnapshot.participants ∪ pendingJoiners`, where pending
joiners are derived from the inbound message blocks between the two snapshots' inbound tips
(`_deriveMilestoneUnionParticipants`). Each milestone snapshot must hash-match the anchor's
`stateSnapshotHash`, and then becomes the threshold context for the next hop.
Current, off-chain: [`AgreementManager.getStateProof`](../../../../../src/agreementManager/AgreementManager.ts#L67)
builds one milestone per participant-set change point
(`storage.participantSetChanges.getChangePointsInRange`) plus a final milestone for the latest
provable state, with the threshold signers of each milestone taken as previous-snapshot
participants ∪ resulting-snapshot participants.

Current: [`DisputeVerificationFacet.reduce`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L61)
selects the candidate latest block with the highest `transactionCnt` across committed disputes,
breaking exact-height ties deterministically by lower block hash; invalid claims are removed via
dispute fraud proofs before/while they matter ([disputes.md](./disputes.md),
[fraud-proofs.md](./fraud-proofs.md)).

## 7. Exact verification pipeline (current)

[`StateProofFacet.verifyStateProof(dispute, auditingData)`](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L1)
— reachable via [`StateChannelManagerProxy.verifyStateProof`](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L459) —
accepts iff all of the following hold:

1. **Auditing reference:** `dispute.input.disputeAuditingDataHash == keccak256(abi.encode(auditingData))`.
2. **Fork identity:** `forkId == keccak256(abi.encode(auditingData.genesisStateSnapshotData))`.
3. **Shape:** not both `milestones` and `signedBlocks` non-empty (see §8).
4. **Milestones** (`verifyMilestones`): K proofs ↔ K snapshots; skip already-settled milestones;
   per milestone — non-empty, decodable blocks, fork id match, hash-linked confirmations,
   authentic author signature on every confirmation (`signer == header.participant`), signatures
   accumulated into the union threshold set of §4, full coverage required, and
   `keccak256(abi.encode(milestoneSnapshots[i]))` equal to the anchor block's
   `stateSnapshotHash`.
5. **Signed blocks** (`_areSignedBlocksLinkedAndVerified`): each block decodes; the first has
   `transactionCnt == 0`; each later block's `previousBlockHash` equals the keccak of the
   previous encoded block; each carries a valid author signature matching its declared author.
   _Not_ checked here: that the signer is a channel participant — a non-participant block fails
   the on-chain state transition instead, and the dispute is then slashable; block-structure
   contiguity (`transactionCnt` strictly +1) is enforced on the fraud-proof side
   (`isInvalidBlockStructureInStateProof`, `DisputeInvalidBlockStructure`).
6. **Latest-state claim** (`isCorrectLatestState`): the last block of the proof (or the
   reconstructed genesis snapshot for an empty proof) must hash-match
   `dispute.input.latestStateSnapshotHash`.
7. **Commitment:** `dispute.input.latestStateSnapshotHash == keccak256(abi.encode(auditingData.latestStateSnapshot))`.

A dispute whose proof fails these checks is subject to the `DisputeInvalidStateProof` /
`DisputeNotLatestState` / structure-related dispute fraud proofs
([fraud-proofs.md](./fraud-proofs.md)).

## 8. Current vs. intended divergences

- **Milestones and trailing signed blocks are mutually exclusive.**
    - Intended: `StateProof` = milestone anchors **plus** a trailing signed-block suffix from the
      last anchor to the latest non-final state (§3, §5).
    - Current: `verifyStateProof` and `isCorrectLatestState` reject a proof where both arrays are
      non-empty, and `_areSignedBlocksLinkedAndVerified` forces a signed-block suffix to start at
      fork genesis (`transactionCnt == 0`). The SDK mirrors this:
      [`AgreementManager.getStateProof`](../../../../../src/agreementManager/AgreementManager.ts#L67)
      emits either milestones-only (comment: "signedBlocks are empty since the milestone already
      accounted the latest state") or a genesis-anchored signed-block chain when no milestone can
      be built at all.
    - Consequence (inferred): once any milestone exists, the provable latest state is the last
      block _inside_ the last milestone — a newer non-final suffix beyond the last anchor cannot be
      presented, so the dispute may operate on an older state than the intended model allows. The
      `ProofTypes.sol` comment ("signed blocks that cryptographically connect the last milestone")
      and the fraud-proof-side structure walker
      (`_getUnfinalizedBlockConfirmationsFromStateProof` treats the last milestone's tail _or_ the
      signed blocks as the unfinalized region) both describe the intended mixed shape, so the
      restriction looks like an implementation cut, not a design decision.
    - **Open question:** confirm the intended mixed shape and extend
      `_areSignedBlocksLinkedAndVerified` / `isCorrectLatestState` / the SDK builder to anchor a
      suffix at the last milestone (first suffix block linking to the anchor's last confirmation,
      `transactionCnt` continuing from it), or explicitly ratify the current milestones-XOR-suffix
      design and its staleness consequence.
- **Milestone-snapshot cardinality comment mismatch.** `DisputeAuditingData.milestoneSnapshots`
  is documented as "for K milestones there will be K−1 snapshots, since the first milestone is
  the genesisSnapshot", but `verifyMilestones` requires exactly K snapshots for K milestone
  proofs. Observed fact; the code is self-consistent, the comment is stale. **Open question:**
  fix the comment or the convention.
- **Unbounded verification gas.** The milestone verifier notes its own gap
  (`TODO - need a gas limit on verifyMilestone and on verifyStateProof, so large proofs that
can't be verified won't be spammed`). Inferred concern: oversized proofs as a griefing vector.
  Tracked as an open question in [security/data-availability.md](../security/data-availability.md)
  context.
- **Debug logging in production contract.** `StateProofFacet` imports `hardhat/console.sol` and
  logs during verification. Observed fact; must be removed for deployment (contract size and gas)
  — belongs to the contracts cleanup in
  [contracts/architecture.md](../../implementation/architecture/contracts/architecture.md).

## System integration test plan

For every conformance row, refine the specification permutations with the concrete public entry points, state/storage boundaries, failure and recovery paths, concurrency/interleaving risks, and platform-specific behavior introduced by this implementation. This section defines obligations only; exact test evidence belongs in the matching verification document.

The supporting implementation analyses contain the currently authored component-level permutations. They remain obligations until consolidated into this subject document; they must not be treated as concrete test evidence here.

No stable system-integration cases have been consolidated in this subject yet. The required schema
is retained so the omission is explicit and generated analysis can track the migration.

| Integration test ID | Specification IDs | Specification test IDs | Setup and stimulus | Expected result | Required permutations |
| ------------------- | ----------------- | ---------------------- | ------------------ | --------------- | --------------------- |

## Source inventory

Every source file relevant to this specification belongs here. A missing file is an implementation-documentation gap even when the code itself works.

| Source file                                                                                                                                                    | Specification IDs                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [contracts/V1/helpers/LibraryTestContract.sol](../../../../../contracts/V1/helpers/LibraryTestContract.sol#L3)                                                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol#L13)        | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeManagerFacet.sol#L3)               | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L3)     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/Errors.sol](../../../../../contracts/V1/StateChannelDiamondProxy/Errors.sol#L1)                                         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L8)                       | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol#L3)                     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol](../../../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol#L3)                             | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol#L3)                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol#L3)     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerStorage.sol#L3) | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L3)                       | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol#L3)                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol](../../../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol#L3)                             | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/BlockUtils.sol#L3)                     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol#L3)                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol](../../../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol#L3)                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelManagerEvents.sol](../../../../../contracts/V1/StateChannelManagerEvents.sol#L3)                                                     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/StateChannelManagerInterface.sol](../../../../../contracts/V1/StateChannelManagerInterface.sol#L3)                                               | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/types/DisputeFraudProofTypes.sol](../../../../../contracts/V1/types/DisputeFraudProofTypes.sol#L3)                                               | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/types/DisputeTypes.sol](../../../../../contracts/V1/types/DisputeTypes.sol#L6)                                                                   | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [contracts/V1/types/ProofTypes.sol](../../../../../contracts/V1/types/ProofTypes.sol#L3)                                                                       | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/agreementManager/AgreementManager.ts](../../../../../src/agreementManager/AgreementManager.ts#L1)                                                         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/cache/index.ts](../../../../../src/cache/index.ts#L1)                                                                                                     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/cache/SignerRecoveryCache.ts](../../../../../src/cache/SignerRecoveryCache.ts#L15)                                                                        | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/disputeManager/DisputeManager.ts](../../../../../src/disputeManager/DisputeManager.ts#L1)                                                                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/eventHandlers/EventHandler.ts](../../../../../src/eventHandlers/EventHandler.ts#L1)                                                                       | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/rpc/services/stateTransition/StateTransitionRpcMethods.ts](../../../../../src/rpc/services/stateTransition/StateTransitionRpcMethods.ts#L1)               | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/rpc/services/stateTransition/StateTransitionService.ts](../../../../../src/rpc/services/stateTransition/StateTransitionService.ts#L1)                     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/StateChannelEventListener.ts](../../../../../src/StateChannelEventListener.ts#L1)                                                                         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/BlockQueueManager.ts](../../../../../src/stateManager/BlockQueueManager.ts#L48)                                                              | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/DisputeValidationService.ts](../../../../../src/stateManager/DisputeValidationService.ts#L33)                                                | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/EventSyncService.ts](../../../../../src/stateManager/EventSyncService.ts#L1)                                                                 | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/reduction/index.ts](../../../../../src/stateManager/reduction/index.ts#L1)                                                                   | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/reduction/ReductionComputationService.ts](../../../../../src/stateManager/reduction/ReductionComputationService.ts#L24)                      | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/reduction/ReductionExecutor.ts](../../../../../src/stateManager/reduction/ReductionExecutor.ts#L69)                                          | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/reduction/ReductionManager.ts](../../../../../src/stateManager/reduction/ReductionManager.ts#L52)                                            | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/snapshotUpdate/SnapshotUpdateService.ts](../../../../../src/stateManager/snapshotUpdate/SnapshotUpdateService.ts#L41)                        | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/StateManager.ts](../../../../../src/stateManager/StateManager.ts#L1)                                                                         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/utils/DisputeFraudProofService.ts](../../../../../src/stateManager/utils/DisputeFraudProofService.ts#L8)                                     | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/utils/FraudProofService.ts](../../../../../src/stateManager/utils/FraudProofService.ts#L16)                                                  | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/ValidationService.ts](../../../../../src/stateManager/ValidationService.ts#L15)                                                              | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/validationStrategy/BlockValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/BlockValidationStrategy.ts#L1)             | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/validationStrategy/CalldataCommittedStrategy.ts](../../../../../src/stateManager/validationStrategy/CalldataCommittedStrategy.ts#L1)         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/validationStrategy/DisputeValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/DisputeValidationStrategy.ts#L1)         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/stateManager/validationStrategy/SpectatingValidationStrategy.ts](../../../../../src/stateManager/validationStrategy/SpectatingValidationStrategy.ts#L229) | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/BlockStorage.ts](../../../../../src/storage/BlockStorage.ts#L1)                                                                                   | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/DisputeFraudProofStorage.ts](../../../../../src/storage/DisputeFraudProofStorage.ts#L1)                                                           | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/DisputeStorage.ts](../../../../../src/storage/DisputeStorage.ts#L1)                                                                               | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/ForceExitStorage.ts](../../../../../src/storage/ForceExitStorage.ts#L1)                                                                           | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/FraudProofStorage.ts](../../../../../src/storage/FraudProofStorage.ts#L1)                                                                         | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/QueueStorage.ts](../../../../../src/storage/QueueStorage.ts#L1)                                                                                   | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |
| [src/storage/TimeoutStorage.ts](../../../../../src/storage/TimeoutStorage.ts#L1)                                                                               | `REQ-SP-1`, `REQ-SP-2`, `REQ-SP-3`, `REQ-SP-4`, `REQ-SP-5`, `INV-SP-6`, `REQ-SP-7` |

### Supporting implementation analyses

- [architecture/sdk/block-confirmation-pipeline.md](../architecture/sdk/block-confirmation-pipeline.md)
- [architecture/sdk/dispute-pipeline.md](../architecture/sdk/dispute-pipeline.md)
- [architecture/contracts/manager-and-facets.md](../architecture/contracts/manager-and-facets.md)

## Conformance traceability

This table records whether the repository currently implements each requirement. It does not change the requirement or claim approval; code evidence remains pending until an engineer verifies it.

| Requirement / invariant | Implementation status                      | Source evidence                                                                                                                                                                                                                                                    | Design decisions / assumptions                                                                     | Implementation-specific test obligations                                                                                                                                        | Gap / divergence                                                                   |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `REQ-SP-1`              | Implemented; engineer verification pending | [StateProofFacet.\_isMilestoneFinalWithExpectedParticipants](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L1); [AgreementManager.tryBuildMilestone](../../../../../src/agreementManager/AgreementManager.ts#L106)                      | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-SP-1.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-SP-2`              | Implemented; engineer verification pending | [StateProofFacet.verifyStateProof / isCorrectLatestState](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L46)                                                                                                                            | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-SP-2.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-SP-3`              | Implemented; engineer verification pending | [StateProofFacet.verifyMilestones / \_deriveMilestoneUnionParticipants](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L114); [AgreementManager.getStateProof](../../../../../src/agreementManager/AgreementManager.ts#L67)              | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-SP-3.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-SP-4`              | Implemented; engineer verification pending | [StateProofFacet.isCorrectLatestState / \_areSignedBlocksLinkedAndVerified](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L9)                                                                                                           | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-SP-4.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-SP-5`              | Implemented; engineer verification pending | [StateProofFacet.isCorrectLatestState](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L9); [DisputeVerificationFacet.reduceOutputToSnapshotData](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L143) | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-SP-5.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `INV-SP-6`              | Implemented; engineer verification pending | [DisputeVerificationFacet.reduce](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L61); [FraudProofFacet](../../../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol#L10) (`BlockDoubleSign`)                      | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `INV-SP-6.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
| `REQ-SP-7`              | Implemented; engineer verification pending | [StateProofFacet](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L8)                                                                                                                                                                     | See the design section above; requirement-specific mechanism and hidden-assumption review pending. | Apply every `REQ-SP-7.T*` permutation through the listed concrete boundaries, including implementation-only failure, recovery, persistence, concurrency, and platform variants. | Engineer audit pending; any current divergence named in the evidence remains open. |
