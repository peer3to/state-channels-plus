pragma solidity ^0.8.8;

import "./DataTypes.sol";

contract DisputeFraudProofTypes {
    constructor(
        DisputeNotLatestState memory a,
        DisputeInvalidOutputState memory b,
        DisputeInvalidStateProof memory c,
        DisputeInvalidBalanceInvariant memory g,
        DisputeOnChainSlashesNotSubset memory h,
        TimeoutThreshold memory i,
        TimeoutCalldataPosted memory j,
        TimeoutNotLinkedToLatestState memory k,
        TimeoutParticipantNotNext memory l,
        TimeoutTooEarly memory m,
        DisputeInvalidBlockInStateProofApplyFraudProof memory n,
        DisputeLastMilestoneNotFinalAndNoAuditingData memory o,
        InvalidDisputeReason memory p,
        DisputeStateProofHeaderMismatch memory q,
        DisputeInboundHashNotInChain memory r,
        DisputeInvalidBlockStructure memory s,
        DisputeBlockAuthorNotParticipant memory t,
        DisputeInboundAnchorBehindLatestState memory u,
        DisputeStateProofBelowOnChainAnchor memory v,
        TimeoutSupersededByFinalState memory w,
        DisputeConflictsWithFinalState memory x,
        DisputeInvalidOutboundRun memory y
    ) {}
}

// ========================== Dispute related fraud proofs ==========================
// Every Dispute Fraud Proof has an implicit argument/field `Dispute dispute`

// This is semantically equivalent to SignedBlock, but logically it's any signature not only from the original block author
struct DisputeNotLatestState {
    bytes encodedBlock;
    bytes signature;
}

struct DisputeInvalidOutputState {
    StateSnapshot latestStateSnapshot;
    bytes latestStateMachineState;
    MessageBlock[] inboundMessageBlocks;
}

/// @dev Challenges one step of the state-proof walk: milestone `milestoneIndex`, and with `hasBlockIndex` only its
/// block `blockIndex` (and that block's predecessor) under the per-block rules. With posted auditing data,
/// `auditingData` must be the committed data and the step's snapshots are read from it. With omitted data, the
/// challenger supplies the genesis data in `auditingData` and the step's `previousStateSnapshot` (milestone i-1's
/// first-block snapshot) and `resultingStateSnapshot` (milestone i's); a supplied snapshot its block does not commit
/// to makes the challenge invalid. A latest state that is not the proof's is a fault at any step.
struct DisputeInvalidStateProof {
    uint256 milestoneIndex;
    bool hasBlockIndex;
    uint256 blockIndex;
    DisputeAuditingData auditingData;
    StateSnapshot previousStateSnapshot;
    StateSnapshot resultingStateSnapshot;
}

/// @dev `latestStateSnapshot` must be the dispute's latest state
struct DisputeInvalidBalanceInvariant {
    StateSnapshot latestStateSnapshot;
    bytes latestStateMachineState;
}

struct DisputeOnChainSlashesNotSubset {
    bool __;
}

// ========================== Timeout related fraud proofs ==========================

struct TimeoutThreshold {
    BlockConfirmation thresholdBlock; // only N/N on single block - no virtual voting
    StateSnapshot latestStateSnapshot;
    StateSnapshot thresholdStateSnapshot;
}

struct TimeoutNotLinkedToLatestState {
    bool __; // this is not used, the implicit dispute field is enough to deduct
}
// Linked to latestState, but participant is not next block author

struct TimeoutParticipantNotNext {
    StateSnapshot latestStateSnapshot;
    bytes latestStateStateMachineState;
}

struct TimeoutTooEarly {
    SnapshotData genesisStateSnapshotData;
    uint256 previousBlockOnChainTimestamp;
}

struct TimeoutCalldataPosted {
    SnapshotData genesisStateSnapshotData;
    StateSnapshot latestStateSnapshot;
    bytes latestStateStateMachineState;
    SignedBlock postedBlock;
    uint256 onChainTimestamp;
    uint256 previousBlockOnChainTimestamp;
    SignedBlock previousBlockcalldata;
}

// A threshold-final state on the dispute's fork at or above the timeout height: the accused height was produced, so
// the timeout is false. `finalProof` is walked from the chain's start; its final point must be committed by a block
// (not the fork genesis). A same-fork chain anchor at or above the timeout height counts without a proof.
struct TimeoutSupersededByFinalState {
    ProofWalkInput finalProof;
}

// A threshold-final state F of the dispute's fork (`finalProof`, walked from the chain's start; F is not the fork
// genesis) and the dispute's block at `blockIndex` of milestone `milestoneIndex`, one the dispute's walk checks, at F's
// height that commits another snapshot: the dispute's history conflicts with the final history.
struct DisputeConflictsWithFinalState {
    ProofWalkInput finalProof;
    uint256 milestoneIndex;
    uint256 blockIndex;
}

// The block-specific wrappers locate the challenged block at `blockIndex` counted from the start of the last
// milestone; see `StateProofFacet.isBlockChallengeEligible` for the protected boundary.
struct DisputeInvalidBlockInStateProofApplyFraudProof {
    FraudProof fraudProof;
    uint256 blockIndex;
}

struct DisputeLastMilestoneNotFinalAndNoAuditingData {
    bool __;
}

struct InvalidDisputeReason {
    StateSnapshot latestStateSnapshot;
}

struct DisputeStateProofHeaderMismatch {
    bool __;
}

struct DisputeInboundHashNotInChain {
    bool __;
}

// dispute.input.lastInboundMessageBlockHeight is not ahead of
// latestStateSnapshot.snapshotData.latestInboundMessageBlockHeight
struct DisputeInboundAnchorBehindLatestState {
    StateSnapshot latestStateSnapshot;
}

struct DisputeInvalidBlockStructure {
    uint256 blockIndex;
}

struct DisputeBlockAuthorNotParticipant {
    uint256 blockIndex;
    SignedBlock previousBlock;
    StateSnapshot previousStateSnapshot;
    StateSnapshot resultingStateSnapshot;
}

// The dispute's latest state is strictly below the same-fork on-chain anchor, which the chain reads itself. An empty
// proof claims the fork genesis, which any same-fork non-genesis anchor (also block zero's resulting snapshot) is past.
struct DisputeStateProofBelowOnChainAnchor {
    bool __;
}

// `auditingData` is the dispute's committed posted data with its latest state. Its outbound run, cut at the chain
// anchor's outbound head, does not link that head to the latest state's (StateProofFacet.isDisputeOutboundRunInvalid).
struct DisputeInvalidOutboundRun {
    DisputeAuditingData auditingData;
}
