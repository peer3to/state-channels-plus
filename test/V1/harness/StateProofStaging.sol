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
    DisputeBlockAuthorNotParticipant,
    DisputeInvalidBalanceInvariant,
    DisputeInvalidBlockInStateProofApplyFraudProof,
    DisputeInvalidBlockStructure,
    DisputeInvalidStateProof,
    DisputeLastMilestoneNotFinalAndNoAuditingData,
    DisputeStateProofBelowOnChainAnchor,
    DisputeStateProofHeaderMismatch,
    TimeoutSupersededByFinalState,
    DisputeConflictsWithFinalState
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {InvalidTimestampProof} from "../../../contracts/V1/types/FraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The dispute fraud-proof pipeline over its own storage: the DisputeFraudProofFacet handlers with
/// DisputeVerificationFacet's kill and balance invariant inline, and StateProofFacet, FraudProofFacet and UtilityFacet
/// reached by delegatecall like the proxy routes them. A test places the chain snapshot, inbound blocks, withdrawals,
/// slashes and the committed dispute directly.
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

    /// stores `inbound` under its hash, as the chain's new inbound head
    function seedInboundBlock(bytes32 channelId, MessageBlock memory inbound) external returns (bytes32 hash) {
        hash = keccak256(abi.encode(inbound));
        MessageBlock storage stored = inboundMessageBlockMap[channelId][hash];
        stored.previousBlockHash = inbound.previousBlockHash;
        stored.blockHeight = inbound.blockHeight;
        stored.totalBalance = inbound.totalBalance;
        stored.timestamp = inbound.timestamp;
        for (uint256 i = 0; i < inbound.messages.length; i++) {
            stored.messages.push(inbound.messages[i]);
        }
        channelBalances[channelId].latestInboundMessageBlockHash = hash;
        channelBalances[channelId].latestInboundMessageBlockHeight = inbound.blockHeight;
    }

    /// commits `dispute` in its fork's open window the way `uploadDispute` leaves it
    function seedDispute(Dispute memory dispute) external {
        DisputeWindow storage window =
            _seedDisputeWindow(dispute.input.channelId, dispute.input.forkId, block.timestamp, block.timestamp);
        window.evidence.disputeCommitments.push(keccak256(abi.encode(dispute)));
        window.evidence.hasPosted.push(dispute.input.disputer);
    }

    /// `originForkId`'s window expired: a successor fork's genesis is dated by its kill period end
    function seedExpiredOriginWindow(bytes32 channelId, bytes32 originForkId) external returns (uint256) {
        _seedDisputeWindow(
            channelId, originForkId, block.timestamp - 2 * evidenceTime, block.timestamp - 2 * evidenceTime
        );
        return block.timestamp - evidenceTime;
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

/// Real histories for the state-proof walk and the dispute fraud proofs over it: a fork whose ID hashes its genesis
/// data (participants A and B), linked runs whose blocks commit per-height snapshots, inbound JOIN blocks stored under
/// their real hashes, committed disputes and allegations submitted by a challenger.
abstract contract StateProofStaging is DiamondHarness {
    bytes32 internal constant CHANNEL = keccak256("challenge-channel");
    uint256 internal constant ANCHOR_HEIGHT = 5;
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;
    uint256 internal constant CAROL_KEY = 0xC0FFEE;
    uint256 internal constant DAVE_KEY = 0xDA7E;
    uint256 internal constant GENESIS_TIMESTAMP = 7;
    /// the fork genesis's state
    bytes internal constant GENESIS_STATE = "genesis state";

    StateProofHarness internal harness;
    SnapshotData internal genesisData;
    /// the fork ID hashes the genesis data, so a dispute's genesis reference links to it
    bytes32 internal forkId;
    StateSnapshot internal genesis;
    address internal alice = vm.addr(ALICE_KEY);
    address internal bob = vm.addr(BOB_KEY);
    address internal carol = vm.addr(CAROL_KEY);
    address internal dave = vm.addr(DAVE_KEY);

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
        s.snapshotData = abi.decode(abi.encode(genesisData), (SnapshotData));
        s.snapshotData.participants = participants;
        s.snapshotData.stateMachineStateHash = keccak256(_state(height, participants));
        s.forkId = forkId;
        s.blockHeight = height;
        s.timestamp = height + 100;
    }

    /// `_snapshot` that consumed the inbound run up to `inboundHash` at `inboundHeight`
    function _snapshotAt(uint256 height, address[] memory participants, bytes32 inboundHash, uint256 inboundHeight)
        internal
        view
        returns (StateSnapshot memory s)
    {
        s = _snapshot(height, participants);
        s.snapshotData.latestInboundMessageBlockHash = inboundHash;
        s.snapshotData.latestInboundMessageBlockHeight = inboundHeight;
    }

    /// the state `_snapshot(height, participants)` commits
    function _state(uint256 height, address[] memory participants) internal pure returns (bytes memory) {
        return abi.encode("state", height, participants);
    }

    /// the snapshot hash a block at `height` commits by default: A and B's snapshot at that height
    function _hashAt(uint256 height) internal view returns (bytes32) {
        return keccak256(abi.encode(_snapshot(height, genesisData.participants)));
    }

    /// a balance-carrying snapshot at `height` with A and B, consuming the inbound head `inboundHash`, its real Math
    /// state and its machine-state bytes; the state holds `stateBalance`
    function _balanceSnapshot(
        uint256 height,
        bytes32 inboundHash,
        uint256 deposits,
        uint256 withdrawals,
        uint256 stateBalance
    ) internal view returns (StateSnapshot memory s, bytes memory encodedState) {
        MathState memory state;
        state.number = height;
        state.participants = genesisData.participants;
        state.balances = new uint256[](2);
        state.balances[0] = stateBalance;
        encodedState = abi.encode(state);
        s = _snapshotAt(height, genesisData.participants, inboundHash, 1);
        s.snapshotData.stateMachineStateHash = keccak256(encodedState);
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

    /// the private key of a staged identity
    function _keyOf(address participant) internal view returns (uint256) {
        if (participant == alice) return ALICE_KEY;
        if (participant == bob) return BOB_KEY;
        if (participant == carol) return CAROL_KEY;
        return DAVE_KEY;
    }

    // ---- inbound ----

    /// stores an inbound block holding `participant`'s JOIN after `previousHash` as the chain's inbound head
    function _seedJoin(bytes32 previousHash, uint256 height, address participant)
        internal
        returns (MessageBlock memory inbound, bytes32 hash)
    {
        inbound = _joinBlock(previousHash, height, participant, 0);
        hash = harness.seedInboundBlock(CHANNEL, inbound);
    }

    /// an inbound block holding `participant`'s JOIN carrying `deposit`, the channel's total deposits after it
    function _joinBlock(bytes32 previousHash, uint256 height, address participant, uint256 deposit)
        internal
        view
        returns (MessageBlock memory inbound)
    {
        JoinChannel memory join;
        join.channelId = CHANNEL;
        join.participant = participant;
        join.balance.amount = deposit;
        inbound.previousBlockHash = previousHash;
        inbound.blockHeight = height;
        inbound.timestamp = block.timestamp;
        inbound.totalBalance.amount = deposit;
        inbound.messages = new Message[](1);
        inbound.messages[0] = Message({
            messageType: MESSAGE_TYPE_JOIN,
            participant: participant,
            balance: join.balance,
            data: abi.encode(join)
        });
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

    /// `_run` whose first block commits `firstSnapshot` instead
    function _hopRun(StateSnapshot memory firstSnapshot, uint256 count, uint256[] memory signers)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        uint256 firstHeight = firstSnapshot.blockHeight;
        milestone = _run(firstHeight, count, keccak256(abi.encode("predecessor", firstHeight)), signers);
        _commitAt(milestone, 0, keccak256(abi.encode(firstSnapshot)), signers);
    }

    /// `_run` whose first block commits the snapshot at `firstHeight` with `participants`
    function _thresholdRun(uint256 firstHeight, uint256 count, address[] memory participants, uint256[] memory signers)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        return _hopRun(_snapshot(firstHeight, participants), count, signers);
    }

    /// a genesis-linked run of `count` blocks whose block 0 commits `zeroSnapshot`
    function _genesisRunTo(StateSnapshot memory zeroSnapshot, uint256 count, uint256[] memory zeroSigners)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        milestone = _run(0, count, keccak256(abi.encode(genesis)), zeroSigners);
        _commitAt(milestone, 0, keccak256(abi.encode(zeroSnapshot)), zeroSigners);
    }

    /// a genesis-linked run of `count` blocks whose block 0 commits the snapshot with `participants`
    function _genesisRun(uint256 count, address[] memory participants, uint256[] memory zeroSigners)
        internal
        view
        returns (MilestoneProof memory milestone)
    {
        return _genesisRunTo(_snapshot(0, participants), count, zeroSigners);
    }

    /// replaces block `blockIndex` by `b` signed by `signers` (the first as the block signature) and relinks every
    /// later block to it, each re-signed by its own author
    function _replaceBlock(
        MilestoneProof memory milestone,
        uint256 blockIndex,
        Block memory b,
        uint256[] memory signers
    ) internal view {
        milestone.blockConfirmations[blockIndex] = _blockConfirmation(abi.encode(b), signers);
        for (uint256 i = blockIndex + 1; i < milestone.blockConfirmations.length; i++) {
            Block memory next = _decode(milestone, i);
            next.previousBlockHash = keccak256(milestone.blockConfirmations[i - 1].signedBlock.encodedBlock);
            bytes memory encoded = abi.encode(next);
            milestone.blockConfirmations[i] = BlockConfirmation({
                signedBlock: SignedBlock({
                    encodedBlock: encoded,
                    signature: _sign(_keyOf(next.transaction.header.participant), encoded)
                }),
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
    ) internal view {
        Block memory b = _decode(milestone, blockIndex);
        b.stateSnapshotHash = stateSnapshotHash;
        _replaceBlock(milestone, blockIndex, b, signers);
    }

    /// every block of `milestone` names `targetForkId` and commits that fork's default snapshot at its height, block 0
    /// links to `firstPreviousHash`; each is re-signed by its author, the first also by `firstSigners`
    function _onFork(
        MilestoneProof memory milestone,
        bytes32 targetForkId,
        bytes32 firstPreviousHash,
        uint256[] memory firstSigners
    ) internal view {
        for (uint256 i = 0; i < milestone.blockConfirmations.length; i++) {
            Block memory b = _decode(milestone, i);
            b.transaction.header.forkId = targetForkId;
            StateSnapshot memory committed = _snapshot(b.transaction.header.transactionCnt, genesisData.participants);
            committed.forkId = targetForkId;
            b.stateSnapshotHash = keccak256(abi.encode(committed));
            if (i == 0) b.previousBlockHash = firstPreviousHash;
            _replaceBlock(milestone, i, b, i == 0 ? firstSigners : _signers(_keyOf(b.transaction.header.participant)));
        }
    }

    /// block `blockIndex` is authored by the first of `signers`, who signs it with the rest; later blocks are relinked
    function _authorAt(MilestoneProof memory milestone, uint256 blockIndex, uint256[] memory signers) internal view {
        Block memory b = _decode(milestone, blockIndex);
        b.transaction.header.participant = vm.addr(signers[0]);
        _replaceBlock(milestone, blockIndex, b, signers);
    }

    /// block `blockIndex` no longer links to its predecessor: a structure offense; later blocks are relinked
    function _breakLinkAt(MilestoneProof memory milestone, uint256 blockIndex) internal view {
        Block memory b = _decode(milestone, blockIndex);
        b.previousBlockHash = keccak256("not the predecessor");
        _replaceBlock(milestone, blockIndex, b, _signers(_keyOf(b.transaction.header.participant)));
    }

    /// block `blockIndex` names another fork in its header: a header offense; later blocks are relinked
    function _otherForkAt(MilestoneProof memory milestone, uint256 blockIndex) internal view {
        Block memory b = _decode(milestone, blockIndex);
        b.transaction.header.forkId = keccak256("other-fork");
        _replaceBlock(milestone, blockIndex, b, _signers(_keyOf(b.transaction.header.participant)));
    }

    /// block `blockIndex` carries B's signature while its header names A: an authenticity offense
    function _badAuthorAt(MilestoneProof memory milestone, uint256 blockIndex) internal pure {
        SignedBlock memory signedBlock = milestone.blockConfirmations[blockIndex].signedBlock;
        signedBlock.signature = _sign(BOB_KEY, signedBlock.encodedBlock);
    }

    /// block `blockIndex` is dated `timestamp` and signed by `signers`; later blocks are relinked
    function _redateAt(MilestoneProof memory milestone, uint256 blockIndex, uint256 timestamp, uint256[] memory signers)
        internal
        view
    {
        Block memory b = _decode(milestone, blockIndex);
        b.transaction.header.timestamp = timestamp;
        _replaceBlock(milestone, blockIndex, b, signers);
    }

    /// block `blockIndex` is dated before its predecessor in the run, signed by `signers`
    function _backdateAt(MilestoneProof memory milestone, uint256 blockIndex, uint256[] memory signers) internal view {
        uint256 previousTimestamp = _decode(milestone, blockIndex - 1).transaction.header.timestamp;
        _redateAt(milestone, blockIndex, previousTimestamp - 1, signers);
    }

    // ---- disputes ----

    /// A's dispute without posted auditing data; its latest state is what the last block commits
    function _dispute(MilestoneProof[] memory milestones) internal view returns (Dispute memory dispute) {
        return _disputeBy(alice, milestones);
    }

    /// `disputer`'s dispute on this fork carrying `milestones`, without posted auditing data
    function _disputeBy(address disputer, MilestoneProof[] memory milestones)
        internal
        view
        returns (Dispute memory dispute)
    {
        dispute.input.channelId = CHANNEL;
        dispute.input.forkId = forkId;
        dispute.input.disputer = disputer;
        dispute.input.stateProof.milestones = milestones;
        if (milestones.length != 0) {
            MilestoneProof memory last = milestones[milestones.length - 1];
            dispute.input.latestStateSnapshotHash = _decode(last, last.blockConfirmations.length - 1).stateSnapshotHash;
        } else {
            dispute.input.latestStateSnapshotHash = keccak256(abi.encode(genesis));
        }
    }

    /// A's dispute posting the auditing data an honest disputer posts: the genesis data, `snapshots` and the latest
    /// state `latest`
    function _postedDispute(
        MilestoneProof[] memory milestones,
        StateSnapshot[] memory snapshots,
        StateSnapshot memory latest
    ) internal view returns (Dispute memory dispute, DisputeAuditingData memory auditingData) {
        dispute = _dispute(milestones);
        auditingData.genesisStateSnapshotData = genesisData;
        auditingData.milestoneSnapshots = snapshots;
        auditingData.latestStateSnapshot = latest;
        dispute.postedAuditingData = true;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
    }

    function _commit(Dispute memory dispute) internal {
        harness.seedDispute(dispute);
    }

    /// B submits one dispute fraud proof against `dispute`
    function _apply(Dispute memory dispute, DisputeFraudProofType proofType, bytes memory encodedProof) internal {
        _applyBy(bob, dispute, proofType, encodedProof);
    }

    /// `challenger` submits one dispute fraud proof against `dispute`
    function _applyBy(
        address challenger,
        Dispute memory dispute,
        DisputeFraudProofType proofType,
        bytes memory encodedProof
    ) internal {
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: proofType,
            participant: dispute.input.disputer,
            dispute: dispute,
            encodedProof: encodedProof
        });
        vm.prank(challenger);
        harness.applyDisputeFraudProofs(proofs);
    }

    /// the allegation held: the dispute is killed and its disputer slashed, the challenger B keeps its seat
    function _assertKilled(Dispute memory dispute) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 0, "dispute killed");
        assertTrue(harness.isSlashed(CHANNEL, dispute.input.disputer), "disputer slashed");
        assertFalse(harness.isSlashed(CHANNEL, bob), "challenger keeps its seat");
    }

    /// the allegation failed: the dispute stays, its submitter is not punished, the challenger B pays
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

    function _belowAnchorProof() internal pure returns (bytes memory) {
        return abi.encode(DisputeStateProofBelowOnChainAnchor({__: false}));
    }

    function _notFinalProof() internal pure returns (bytes memory) {
        return abi.encode(DisputeLastMilestoneNotFinalAndNoAuditingData({__: false}));
    }

    function _headerMismatchProof() internal pure returns (bytes memory) {
        return abi.encode(DisputeStateProofHeaderMismatch({__: false}));
    }

    /// the challenger's final proof of `milestones` with `snapshots`, naming `proofForkId`
    function _finalProof(bytes32 proofForkId, MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
        internal
        view
        returns (ProofWalkInput memory)
    {
        return ProofWalkInput(CHANNEL, proofForkId, StateProof(milestones), genesisData, snapshots);
    }

    /// a real final state F = 7 on `otherForkId`: the chain anchor is that fork's snapshot at 5 {A, B} and the hop
    /// to 7 runs on that fork, signed by A and B. Returns that fork's final proof.
    function _otherForkFinalAtSeven(bytes32 otherForkId) internal returns (ProofWalkInput memory finalProof) {
        StateSnapshot memory anchor = _snapshot(5, genesisData.participants);
        anchor.forkId = otherForkId;
        harness.seedSnapshot(CHANNEL, anchor);
        StateSnapshot memory seven = _snapshot(7, genesisData.participants);
        seven.forkId = otherForkId;
        MilestoneProof memory hop = _run(7, 1, keccak256("block 6"), _signers(ALICE_KEY, BOB_KEY));
        _onFork(hop, otherForkId, keccak256("block 6"), _signers(ALICE_KEY, BOB_KEY));
        finalProof = _finalProof(otherForkId, _one(hop), _entries(seven));
        ProofWalkResult memory walk = _diamond().verifyMilestones(finalProof);
        assertTrue(walk.valid, "premise: a valid final proof on the other fork");
        assertEq(walk.finalizedSnapshot.blockHeight, 7, "premise: F is block 7 of the other fork");
    }

    /// the timeout-superseded allegation: the challenger's final proof of `milestones` with `snapshots`, naming
    /// `proofForkId`
    function _supersededProof(bytes32 proofForkId, MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(TimeoutSupersededByFinalState(_finalProof(proofForkId, milestones, snapshots)));
    }

    /// the conflict allegation: the challenger's final proof and the dispute's block at `blockIndex` of milestone
    /// `milestoneIndex`
    function _conflictProof(ProofWalkInput memory finalProof, uint256 milestoneIndex, uint256 blockIndex)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(DisputeConflictsWithFinalState(finalProof, milestoneIndex, blockIndex));
    }

    /// the omitted-data invalid-state-proof allegation at milestone `milestoneIndex`: the challenger's genesis data
    /// and that step's snapshots from `snapshots` (milestone i-1's and milestone i's; the genesis where there is none)
    function _invalidStep(StateSnapshot[] memory snapshots, uint256 milestoneIndex)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(_omittedStep(snapshots, milestoneIndex));
    }

    /// `_invalidStep` pointing at block `blockIndex` of that milestone
    function _invalidBlockStep(StateSnapshot[] memory snapshots, uint256 milestoneIndex, uint256 blockIndex)
        internal
        view
        returns (bytes memory)
    {
        DisputeInvalidStateProof memory proof = _omittedStep(snapshots, milestoneIndex);
        proof.hasBlockIndex = true;
        proof.blockIndex = blockIndex;
        return abi.encode(proof);
    }

    /// the posted-data invalid-state-proof allegation at milestone `milestoneIndex` with the committed `auditingData`
    function _postedInvalidStep(DisputeAuditingData memory auditingData, uint256 milestoneIndex)
        internal
        pure
        returns (bytes memory)
    {
        DisputeInvalidStateProof memory proof;
        proof.milestoneIndex = milestoneIndex;
        proof.auditingData = auditingData;
        return abi.encode(proof);
    }

    function _omittedStep(StateSnapshot[] memory snapshots, uint256 milestoneIndex)
        private
        view
        returns (DisputeInvalidStateProof memory proof)
    {
        proof.milestoneIndex = milestoneIndex;
        proof.auditingData.genesisStateSnapshotData = genesisData;
        proof.previousStateSnapshot =
            milestoneIndex != 0 && milestoneIndex <= snapshots.length ? snapshots[milestoneIndex - 1] : genesis;
        proof.resultingStateSnapshot = milestoneIndex < snapshots.length ? snapshots[milestoneIndex] : genesis;
    }

    /// the author-not-participant allegation for the last milestone's block at `blockIndex`
    function _authorProof(
        uint256 blockIndex,
        SignedBlock memory previousBlock,
        StateSnapshot memory previousStateSnapshot,
        StateSnapshot memory resultingStateSnapshot
    ) internal pure returns (bytes memory) {
        return abi.encode(
            DisputeBlockAuthorNotParticipant({
                blockIndex: blockIndex,
                previousBlock: previousBlock,
                previousStateSnapshot: previousStateSnapshot,
                resultingStateSnapshot: resultingStateSnapshot
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

    /// the chain accepts `dispute`'s proof with its committed `auditingData`: the data is the commitment, the
    /// posted latest snapshot is the dispute's, the full walk from the chain's start is valid and the proof's latest
    /// state is the dispute's
    function _chainAcceptsPostedProof(Dispute memory dispute, DisputeAuditingData memory auditingData)
        internal
        view
        returns (bool)
    {
        if (dispute.input.disputeAuditingDataHash != keccak256(abi.encode(auditingData))) return false;
        if (dispute.input.latestStateSnapshotHash != keccak256(abi.encode(auditingData.latestStateSnapshot))) {
            return false;
        }
        ProofWalkResult memory walk = _diamond().verifyMilestones(
            ProofWalkInput(
                dispute.input.channelId,
                dispute.input.forkId,
                dispute.input.stateProof,
                auditingData.genesisStateSnapshotData,
                auditingData.milestoneSnapshots
            )
        );
        return walk.valid && _diamond().isCorrectLatestState(dispute, auditingData.genesisStateSnapshotData);
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

    function _assertFinalized(ProofWalkResult memory result, StateSnapshot memory expected, uint256 replayBlockIndex)
        internal
        pure
    {
        assertTrue(result.valid, "valid walk");
        assertFalse(result.snapshotMismatch, "no evidence mismatch");
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(expected)), "finalized point");
        assertEq(result.replayBlockIndex, replayBlockIndex, "replay start");
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

    function _three(MilestoneProof memory first, MilestoneProof memory second, MilestoneProof memory third)
        internal
        pure
        returns (MilestoneProof[] memory milestones)
    {
        milestones = new MilestoneProof[](3);
        milestones[0] = first;
        milestones[1] = second;
        milestones[2] = third;
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

    function _entries(StateSnapshot memory first, StateSnapshot memory second, StateSnapshot memory third)
        internal
        pure
        returns (StateSnapshot[] memory snapshots)
    {
        snapshots = new StateSnapshot[](3);
        snapshots[0] = first;
        snapshots[1] = second;
        snapshots[2] = third;
    }

    function _inbound(MessageBlock memory first) internal pure returns (MessageBlock[] memory blocks) {
        blocks = new MessageBlock[](1);
        blocks[0] = first;
    }

    function _inbound(MessageBlock memory first, MessageBlock memory second)
        internal
        pure
        returns (MessageBlock[] memory blocks)
    {
        blocks = new MessageBlock[](2);
        blocks[0] = first;
        blocks[1] = second;
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

    function _set(address first, address second, address third, address fourth)
        internal
        pure
        returns (address[] memory addresses)
    {
        addresses = new address[](4);
        addresses[0] = first;
        addresses[1] = second;
        addresses[2] = third;
        addresses[3] = fourth;
    }
}
