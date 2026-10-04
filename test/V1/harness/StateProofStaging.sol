// @spec-test-coverage-ignore: shared Foundry staging for the state-proof walk and the dispute fraud proofs over it, exercised by owning mapped test declarations
pragma solidity ^0.8.8;

import {DiamondHarness} from "./DiamondHarness.sol";
import {DisputeWindowSeeding} from "./DisputeWindowSeeding.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {FraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {_delegatecall} from "../../../contracts/V1/StateChannelDiamondProxy/utils/GeneralUtils.sol";
import {MathState, MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    DisputeInvalidBalanceInvariant,
    DisputeInvalidBlockInStateProofApplyFraudProof,
    DisputeInvalidBlockStructure
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {InvalidTimestampProof} from "../../../contracts/V1/types/FraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The dispute fraud-proof pipeline over its own storage: the DisputeFraudProofFacet handlers with
/// DisputeVerificationFacet's kill and balance invariant inline, and StateProofFacet, FraudProofFacet and UtilityFacet
/// reached by delegatecall like the proxy routes them. A test places the chain snapshot, withdrawals and the
/// committed dispute directly.
contract StateProofHarness is DisputeFraudProofFacet, DisputeVerificationFacet, DisputeWindowSeeding {
    constructor() {
        evidenceTime = 10;
        utilityFacetAddress = address(new UtilityFacet());
        stateProofFacetAddress = address(new StateProofFacet());
        fraudProofFacetAddress = address(new FraudProofFacet());
        disputeVerificationFacetAddress = address(this);
        stateMachineImplementation = new MathStateMachine(3_000_000, 32);
    }

    /// the routed StateProofFacet reads and the `isGenesisSnapshotWithoutTimeCheck` self-call, answered by the facet
    /// the proxy routes them to
    fallback() external {
        address facet = stateProofFacetAddress;
        if (msg.sig == UtilityFacet.isGenesisSnapshotWithoutTimeCheck.selector) facet = utilityFacetAddress;
        bytes memory result = _delegatecall(facet, msg.data);
        assembly ("memory-safe") {
            return(add(result, 32), mload(result))
        }
    }

    function seedSnapshot(bytes32 channelId, StateSnapshot memory snapshot) external {
        stateSnapshots[channelId] = snapshot;
    }

    function seedWithdrawals(bytes32 channelId, Balance memory totalWithdrawals) external {
        channelBalances[channelId].totalWithdrawals = totalWithdrawals;
    }

    /// commits `dispute` in its fork's open window the way `uploadDispute` leaves it
    function seedDispute(Dispute memory dispute) external {
        DisputeWindow storage window =
            _seedDisputeWindow(dispute.input.channelId, dispute.input.forkId, block.timestamp, block.timestamp);
        window.evidence.disputeCommitments.push(keccak256(abi.encode(dispute)));
        window.evidence.hasPosted.push(dispute.input.disputer);
    }

    /// `originForkId`'s window expired and was reduced: a successor fork's genesis is dated by its kill period end
    function seedExpiredOriginWindow(bytes32 channelId, bytes32 originForkId) external returns (uint256) {
        _seedDisputeWindow(
            channelId, originForkId, block.timestamp - 2 * evidenceTime, block.timestamp - 2 * evidenceTime
        );
        return block.timestamp - evidenceTime;
    }

    /// an inbound block `hash` (no predecessor) holding `participant`'s join
    function seedInboundJoin(bytes32 channelId, bytes32 hash, address participant) external {
        MessageBlock storage inbound = inboundMessageBlockMap[channelId][hash];
        inbound.timestamp = block.timestamp;
        JoinChannel memory join;
        join.channelId = channelId;
        join.participant = participant;
        inbound.messages.push(
            Message({
                messageType: MESSAGE_TYPE_JOIN,
                participant: participant,
                balance: join.balance,
                data: abi.encode(join)
            })
        );
    }

    function seedOnChainSlash(bytes32 channelId, address participant) external {
        addOnChainSlashedParticipant(channelId, participant);
    }

    function commitmentCount(bytes32 channelId, bytes32 forkId) external view returns (uint256) {
        return disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments.length;
    }

    function isSlashed(bytes32 channelId, address participant) external view returns (bool) {
        return _isParticipantSlashedOnChain(channelId, participant);
    }

    /// the participant `fraudProof` proves guilty on `channelId` (zero when it proves nothing), judged by the
    /// FraudProofFacet the dispute pipeline delegates to
    function judgeFraudProof(bytes32 channelId, FraudProof memory fraudProof) external returns (address) {
        Dispute memory context;
        context.input.channelId = channelId;
        return runFraudProof(fraudProof, context);
    }
}

/// Real histories for the state-proof walk, the block-pointing challenge wrappers, the balance allegation and the
/// below-anchor counter: a
/// fork whose ID hashes its genesis data (participants A and B), linked runs whose blocks commit per-height snapshots,
/// committed disputes by A and allegations submitted by B.
abstract contract StateProofStaging is DiamondHarness {
    bytes32 internal constant CHANNEL = keccak256("challenge-channel");
    uint256 internal constant ANCHOR_HEIGHT = 5;
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;
    uint256 internal constant CAROL_KEY = 0xC0FFEE;
    uint256 internal constant GENESIS_TIMESTAMP = 7;
    /// the fork genesis's state
    bytes internal constant GENESIS_STATE = "genesis state";
    /// the inbound head the balance scenarios' snapshots consumed; its deposits are the chain snapshot's
    bytes32 internal constant BALANCE_INBOUND_HEAD = keccak256("balance-inbound-head");

    StateProofHarness internal harness;
    SnapshotData internal genesisData;
    /// the fork ID hashes the genesis data, so a dispute's genesis reference links to it
    bytes32 internal forkId;
    StateSnapshot internal genesis;
    address internal alice = vm.addr(ALICE_KEY);
    address internal bob = vm.addr(BOB_KEY);
    address internal carol = vm.addr(CAROL_KEY);

    /// a fresh pipeline whose chain snapshot is the fork genesis {A, B}
    function _stageGenesisChannel() internal {
        vm.warp(1_000_000);
        harness = new StateProofHarness();
        genesisData.stateMachineStateHash = keccak256(GENESIS_STATE);
        genesisData.participants.push(alice);
        genesisData.participants.push(bob);
        forkId = keccak256(abi.encode(genesisData));
        genesis.snapshotData = genesisData;
        genesis.forkId = forkId;
        genesis.timestamp = GENESIS_TIMESTAMP;
        harness.seedSnapshot(CHANNEL, genesis);
    }

    /// moves the chain snapshot to this fork's normal snapshot at `height` with A and B
    function _seedAnchor(uint256 height) internal returns (StateSnapshot memory anchor) {
        anchor = _snapshot(height, genesisData.participants);
        harness.seedSnapshot(CHANNEL, anchor);
    }

    // ---- snapshots and blocks ----

    /// this fork's snapshot at `height` with `participants`; its state names the height and the set
    function _snapshot(uint256 height, address[] memory participants) internal view returns (StateSnapshot memory s) {
        s.snapshotData = genesisData;
        s.snapshotData.participants = participants;
        s.snapshotData.stateMachineStateHash = keccak256(_state(height, participants));
        s.forkId = forkId;
        s.blockHeight = height;
        s.timestamp = height + 100;
    }

    /// the state `_snapshot(height, participants)` commits
    function _state(uint256 height, address[] memory participants) internal pure returns (bytes memory) {
        return abi.encode("state", height, participants);
    }

    /// the state of the snapshot the walk of `milestones` ends at, for a genesis or `_snapshot` end; empty otherwise
    function _finalizedState(MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
        internal
        view
        returns (bytes memory)
    {
        StateSnapshot memory finalized = _walk(milestones, snapshots).finalizedSnapshot;
        bytes32 stateHash = finalized.snapshotData.stateMachineStateHash;
        if (stateHash == keccak256(GENESIS_STATE)) return GENESIS_STATE;
        bytes memory state = _state(finalized.blockHeight, finalized.snapshotData.participants);
        return keccak256(state) == stateHash ? state : bytes("");
    }

    /// the snapshot hash a block at `height` commits by default: A and B's snapshot at that height
    function _hashAt(uint256 height) internal view returns (bytes32) {
        return keccak256(abi.encode(_snapshot(height, genesisData.participants)));
    }

    /// a balance-carrying snapshot at `height` with `participants`, its real Math state and its machine-state bytes;
    /// the state holds the balance the invariant expects (`deposits - withdrawals`) unless `deposits < withdrawals`
    function _balanceSnapshot(uint256 height, address[] memory participants, uint256 deposits, uint256 withdrawals)
        internal
        view
        returns (StateSnapshot memory s, bytes memory encodedState)
    {
        MathState memory state;
        state.number = height;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        state.balances[0] = deposits >= withdrawals ? deposits - withdrawals : 0;
        encodedState = abi.encode(state);
        s = _snapshot(height, participants);
        s.snapshotData.stateMachineStateHash = keccak256(encodedState);
        s.snapshotData.latestInboundMessageBlockHash = BALANCE_INBOUND_HEAD;
        s.snapshotData.totalDeposits.amount = deposits;
        s.snapshotData.totalWithdrawals.amount = withdrawals;
    }

    /// an A-authored block at `height`, dated `1000 + 10 * height`
    function _block(uint256 height, bytes32 previousBlockHash, bytes32 stateSnapshotHash)
        internal
        view
        returns (Block memory b)
    {
        b.transaction.header.channelId = CHANNEL;
        b.transaction.header.participant = alice;
        b.transaction.header.forkId = forkId;
        b.transaction.header.transactionCnt = height;
        b.transaction.header.timestamp = 1000 + 10 * height;
        b.previousBlockHash = previousBlockHash;
        b.stateSnapshotHash = stateSnapshotHash;
    }

    function _decode(MilestoneProof memory milestone, uint256 blockIndex) internal pure returns (Block memory) {
        return abi.decode(milestone.blockConfirmations[blockIndex].signedBlock.encodedBlock, (Block));
    }

    // ---- runs ----

    /// `count` linked A-authored blocks from `firstHeight` committing the default snapshots, the first linked to
    /// `firstPreviousHash` and signed by `firstSigners` (the author first)
    function _run(uint256 firstHeight, uint256 count, bytes32 firstPreviousHash, uint256[] memory firstSigners)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        milestone.blockConfirmations = new BlockConfirmation[](count);
        bytes32 previousHash = firstPreviousHash;
        for (uint256 i = 0; i < count; i++) {
            bytes memory encoded = abi.encode(_block(firstHeight + i, previousHash, _hashAt(firstHeight + i)));
            milestone.blockConfirmations[i] = i == 0
                ? _blockConfirmation(encoded, firstSigners)
                : BlockConfirmation({
                    signedBlock: SignedBlock({encodedBlock: encoded, signature: _sign(ALICE_KEY, encoded)}),
                    signatures: new bytes[](0)
                });
            previousHash = keccak256(encoded);
        }
    }

    /// `_run` whose first block commits the snapshot at `firstHeight` with `participants` instead
    function _thresholdRun(uint256 firstHeight, uint256 count, address[] memory participants, uint256[] memory signers)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        milestone = _run(firstHeight, count, keccak256(abi.encode("predecessor", firstHeight)), signers);
        Block memory first = _decode(milestone, 0);
        first.stateSnapshotHash = keccak256(abi.encode(_snapshot(firstHeight, participants)));
        _replaceBlock(milestone, 0, first, signers);
    }

    /// a genesis-linked run of `count` blocks whose block 0 commits the snapshot with `participants`
    function _genesisRun(uint256 count, address[] memory participants, uint256[] memory zeroSigners)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        milestone = _run(0, count, keccak256(abi.encode(genesis)), zeroSigners);
        Block memory zero = _decode(milestone, 0);
        zero.stateSnapshotHash = keccak256(abi.encode(_snapshot(0, participants)));
        _replaceBlock(milestone, 0, zero, zeroSigners);
    }

    /// replaces block `blockIndex` by `b` signed by `signers` (the first as the block signature) and relinks every
    /// later block to it, each re-signed by its author A
    function _replaceBlock(
        MilestoneProof memory milestone,
        uint256 blockIndex,
        Block memory b,
        uint256[] memory signers
    ) internal pure {
        milestone.blockConfirmations[blockIndex] = _blockConfirmation(abi.encode(b), signers);
        for (uint256 i = blockIndex + 1; i < milestone.blockConfirmations.length; i++) {
            Block memory next = _decode(milestone, i);
            next.previousBlockHash = keccak256(milestone.blockConfirmations[i - 1].signedBlock.encodedBlock);
            bytes memory encoded = abi.encode(next);
            milestone.blockConfirmations[i] = BlockConfirmation({
                signedBlock: SignedBlock({encodedBlock: encoded, signature: _sign(ALICE_KEY, encoded)}),
                signatures: new bytes[](0)
            });
        }
    }

    /// block `blockIndex` now commits `stateSnapshotHash`, signed by `signers`; later blocks are relinked
    function _commitAt(
        MilestoneProof memory milestone,
        uint256 blockIndex,
        bytes32 stateSnapshotHash,
        uint256[] memory signers
    ) internal pure {
        Block memory b = _decode(milestone, blockIndex);
        b.stateSnapshotHash = stateSnapshotHash;
        _replaceBlock(milestone, blockIndex, b, signers);
    }

    /// block `blockIndex` no longer links to its predecessor: a structure offense; later blocks are relinked
    function _breakLinkAt(MilestoneProof memory milestone, uint256 blockIndex) internal pure {
        Block memory b = _decode(milestone, blockIndex);
        b.previousBlockHash = keccak256("not the predecessor");
        _replaceBlock(milestone, blockIndex, b, _signers(ALICE_KEY));
    }

    /// block `blockIndex` carries B's signature while its header names A: an authenticity offense
    function _badAuthorAt(MilestoneProof memory milestone, uint256 blockIndex) internal pure {
        SignedBlock memory signedBlock = milestone.blockConfirmations[blockIndex].signedBlock;
        signedBlock.signature = _sign(BOB_KEY, signedBlock.encodedBlock);
    }

    /// block `blockIndex` is dated `timestamp` (an invalid-timestamp offense when before its predecessor) and signed
    /// by `signers`; later blocks are relinked
    function _redateAt(MilestoneProof memory milestone, uint256 blockIndex, uint256 timestamp, uint256[] memory signers)
        internal
        pure
    {
        Block memory b = _decode(milestone, blockIndex);
        b.transaction.header.timestamp = timestamp;
        _replaceBlock(milestone, blockIndex, b, signers);
    }

    /// a single-run proof whose block `blockIndex` is dated before its predecessor
    function _backdateAt(MilestoneProof memory milestone, uint256 blockIndex, uint256[] memory signers) internal pure {
        uint256 previousTimestamp = _decode(milestone, blockIndex - 1).transaction.header.timestamp;
        _redateAt(milestone, blockIndex, previousTimestamp - 1, signers);
    }

    // ---- scenarios ----

    /// The missed-exit history: the chain snapshot is the withdrawal snapshot 5 (deposits and withdrawals 20, chain
    /// withdrawals 20) while the honest last run [4, 5] starts at the older snapshot 4 (no withdrawals yet).
    function _stageMissedExit()
        internal
        returns (
            StateSnapshot memory anchor,
            bytes memory anchorState,
            StateSnapshot memory older,
            bytes memory olderState,
            MilestoneProof memory run
        )
    {
        (anchor, anchorState) = _balanceSnapshot(ANCHOR_HEIGHT, genesisData.participants, 20, 20);
        (older, olderState) = _balanceSnapshot(ANCHOR_HEIGHT - 1, genesisData.participants, 20, 0);
        harness.seedSnapshot(CHANNEL, anchor);
        harness.seedWithdrawals(CHANNEL, Balance({amount: 20, data: ""}));
        run = _run(ANCHOR_HEIGHT - 1, 2, keccak256("block 3"), _signers(ALICE_KEY));
        _commitAt(run, 0, keccak256(abi.encode(older)), _signers(ALICE_KEY));
        _commitAt(run, 1, keccak256(abi.encode(anchor)), _signers(ALICE_KEY));
    }

    /// From the genesis {A, B}: B leaves at block 3 (the required hop, its old/new union {A, B} signed by
    /// `hopSigners`), then the last run of `lastCount` blocks from 6 that only A, the remaining set, signs - not
    /// everyone of the chain's historic set {A, B}, so only the hop chain can establish it.
    function _exitHopProof(uint256[] memory hopSigners, uint256 lastCount)
        internal
        view
        returns (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
    {
        milestones = _two(
            _thresholdRun(3, 1, _set(alice), hopSigners), _thresholdRun(6, lastCount, _set(alice), _signers(ALICE_KEY))
        );
        snapshots = _entries(_snapshot(3, _set(alice)), _snapshot(6, _set(alice)));
    }

    // ---- disputes ----

    /// A's dispute on this fork carrying `milestones`; with `posted`, it commits auditing data holding `snapshots`
    function _dispute(MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots, bool posted)
        internal
        view
        returns (Dispute memory dispute, DisputeAuditingData memory auditingData)
    {
        dispute.input.channelId = CHANNEL;
        dispute.input.forkId = forkId;
        dispute.input.disputer = alice;
        dispute.input.stateProof.milestones = milestones;
        if (milestones.length != 0) {
            MilestoneProof memory last = milestones[milestones.length - 1];
            dispute.input.latestStateSnapshotHash = _decode(last, last.blockConfirmations.length - 1).stateSnapshotHash;
        } else {
            dispute.input.latestStateSnapshotHash = keccak256(abi.encode(genesis));
        }
        dispute.postedAuditingData = posted;
        if (posted) {
            auditingData.genesisStateSnapshotData = genesisData;
            auditingData.milestoneSnapshots = snapshots;
            // an honest disputer posts the state of the snapshot the walk ends at
            auditingData.latestFinalizedStateStateMachineState = _finalizedState(milestones, snapshots);
            dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        }
    }

    function _commit(Dispute memory dispute) internal {
        harness.seedDispute(dispute);
    }

    /// B submits one dispute fraud proof against `dispute`
    function _apply(Dispute memory dispute, DisputeFraudProofType proofType, bytes memory encodedProof) internal {
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: proofType,
            participant: dispute.input.disputer,
            dispute: dispute,
            encodedProof: encodedProof
        });
        vm.prank(bob);
        harness.applyDisputeFraudProofs(proofs);
    }

    /// the allegation held: the dispute is killed and its disputer slashed, the challenger keeps its seat
    function _assertKilled(Dispute memory dispute) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 0, "dispute killed");
        assertTrue(harness.isSlashed(CHANNEL, dispute.input.disputer), "disputer slashed");
        assertFalse(harness.isSlashed(CHANNEL, bob), "challenger keeps its seat");
    }

    /// the allegation failed: the dispute stays, its submitter is not punished, the challenger pays
    function _assertRejected(Dispute memory dispute) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 1, "dispute stays committed");
        assertFalse(harness.isSlashed(CHANNEL, dispute.input.disputer), "dispute submitter not punished");
        assertTrue(harness.isSlashed(CHANNEL, bob), "the unsupported allegation costs the challenger");
    }

    // ---- allegations ----

    function _structureProof(uint256 blockIndex) internal pure returns (bytes memory) {
        return abi.encode(DisputeInvalidBlockStructure({blockIndex: blockIndex}));
    }

    function _applyProof(FraudProof memory fraudProof, uint256 blockIndex) internal pure returns (bytes memory) {
        return
            abi.encode(DisputeInvalidBlockInStateProofApplyFraudProof({fraudProof: fraudProof, blockIndex: blockIndex}));
    }

    function _balanceProof(StateSnapshot memory latestStateSnapshot, bytes memory latestStateMachineState)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            DisputeInvalidBalanceInvariant({
                latestStateSnapshot: latestStateSnapshot,
                latestStateMachineState: latestStateMachineState
            })
        );
    }

    /// the invalid-timestamp block proof for `invalidBlock`, dated before `previousBlock` (or before the genesis
    /// `previousStateSnapshot` at height 0)
    function _invalidTimestamp(
        SignedBlock memory invalidBlock,
        SignedBlock memory previousBlock,
        StateSnapshot memory previousStateSnapshot
    ) internal view returns (FraudProof memory) {
        return FraudProof({
            proofType: FraudProofType.InvalidTimestamp,
            participant: alice,
            encodedProof: abi.encode(
                InvalidTimestampProof({
                    invalidBlock: invalidBlock,
                    previousBlock: previousBlock,
                    previousStateSnapshot: previousStateSnapshot,
                    participantSignatureOnPreviousBlock: "",
                    previousBlockOnChainTimestamp: 0
                })
            )
        });
    }

    /// the invalid-timestamp block proof for the submitted block at `blockIndex` against its predecessor in the run
    function _invalidTimestampAt(MilestoneProof memory milestone, uint256 blockIndex)
        internal
        view
        returns (FraudProof memory)
    {
        StateSnapshot memory unused;
        return _invalidTimestamp(
            milestone.blockConfirmations[blockIndex].signedBlock,
            milestone.blockConfirmations[blockIndex - 1].signedBlock,
            unused
        );
    }

    // ---- canonical reads ----

    function _diamond() internal view returns (StateChannelManagerInterface) {
        return StateChannelManagerInterface(address(harness));
    }

    function _isEligible(Dispute memory dispute, uint256 blockIndex) internal view returns (bool) {
        return _diamond().isBlockChallengeEligible(dispute, blockIndex);
    }

    /// the shared walk of `milestones` from the chain's start
    function _walk(MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
        internal
        view
        returns (ProofWalkResult memory)
    {
        return
            _diamond().verifyMilestones(ProofWalkInput(CHANNEL, forkId, StateProof(milestones), genesisData, snapshots));
    }

    // ---- small arrays ----

    function _one(MilestoneProof memory first) internal pure returns (MilestoneProof[] memory milestones) {
        milestones = new MilestoneProof[](1);
        milestones[0] = first;
    }

    function _two(MilestoneProof memory first, MilestoneProof memory second)
        internal
        pure
        returns (MilestoneProof[] memory milestones)
    {
        milestones = new MilestoneProof[](2);
        milestones[0] = first;
        milestones[1] = second;
    }

    function _entries(StateSnapshot memory first) internal pure returns (StateSnapshot[] memory snapshots) {
        snapshots = new StateSnapshot[](1);
        snapshots[0] = first;
    }

    function _entries(StateSnapshot memory first, StateSnapshot memory second)
        internal
        pure
        returns (StateSnapshot[] memory snapshots)
    {
        snapshots = new StateSnapshot[](2);
        snapshots[0] = first;
        snapshots[1] = second;
    }

    function _signers(uint256 first) internal pure returns (uint256[] memory keys) {
        keys = new uint256[](1);
        keys[0] = first;
    }

    function _signers(uint256 first, uint256 second) internal pure returns (uint256[] memory keys) {
        keys = new uint256[](2);
        keys[0] = first;
        keys[1] = second;
    }

    function _signers(uint256 first, uint256 second, uint256 third) internal pure returns (uint256[] memory keys) {
        keys = new uint256[](3);
        keys[0] = first;
        keys[1] = second;
        keys[2] = third;
    }

    function _set(address first) internal pure returns (address[] memory addresses) {
        addresses = new address[](1);
        addresses[0] = first;
    }

    function _set(address first, address second) internal pure returns (address[] memory addresses) {
        addresses = new address[](2);
        addresses[0] = first;
        addresses[1] = second;
    }

    function _set(address first, address second, address third) internal pure returns (address[] memory addresses) {
        addresses = new address[](3);
        addresses[0] = first;
        addresses[1] = second;
        addresses[2] = third;
    }
}
