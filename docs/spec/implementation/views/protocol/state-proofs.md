# State Proofs & Milestones — Implementation

> **Specification subject:** [specification/disputes/state-proofs.md](../../../specification/disputes/state-proofs.md)

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

Current: [`DisputeVerificationFacet.reduce`](../../../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol#L60)
selects the candidate latest block with the highest `transactionCnt` across committed disputes,
breaking exact-height ties deterministically by lower block hash; invalid claims are removed via
dispute fraud proofs before/while they matter ([disputes.md](./disputes.md),
[fraud-proofs.md](../architecture/sdk/dispute-pipeline.md)).

## 7. Exact verification pipeline (current)

[`StateProofFacet.verifyStateProof(dispute, auditingData)`](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L1)
— reachable via [`verifyStateProof`](../../../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol#L46), routed to the manager boundary and declared on [StateChannelManagerInterface](../../../../../contracts/V1/StateChannelManagerInterface.sol#L244) —
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
([fraud-proofs.md](../architecture/sdk/dispute-pipeline.md)).

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
  Tracked as an open question in [security/data-availability.md](cross-layer-messages.md)
  context.
- **Debug logging in production contract.** `StateProofFacet` imports `hardhat/console.sol` and
  logs during verification. Observed fact; must be removed for deployment (contract size and gas)
  — belongs to the contracts cleanup in
  [contracts/architecture.md](../architecture/contracts/architecture.md).
