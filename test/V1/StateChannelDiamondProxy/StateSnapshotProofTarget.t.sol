pragma solidity ^0.8.8;

import {
    ErrorInvalidStateProof,
    RaceConditionBlockHeightTooOld
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DiamondHarness} from "../harness/DiamondHarness.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// `updateStateSnapshotSameFork` on the real routed diamond: the update target is the snapshot the last milestone's
/// first block commits, proven final from the chain snapshot; an unfinalized state never becomes the target.
/// Plan 35 cases U65-U67 (with the block-zero participant changes), U109 and U118.
// test naming: test_<plan case>_<scenario>
contract StateSnapshotProofTargetTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    bytes32 internal constant CHANNEL = keccak256("proof-target-channel");
    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant DAVE_PK = 0xDA7E;

    function setUp() public {
        vm.warp(1_000_000);
        diamond = deployDiamond();
        _openChannel(CHANNEL, _keys(ALICE_PK, BOB_PK));
    }

    // ---- U65, U66: the first block's committed snapshot is the target ----

    function test_U65_firstBlockSnapshotIsTheTargetNotTheTail() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(1, 3, _keys(ALICE_PK, BOB_PK), _participants());
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
        assertEq(_onChainHash(), keccak256(abi.encode(states[0])), "the finalized first block's snapshot");
    }

    function test_U65_unfinalizedTailStateCannotBeTheTarget() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(1, 3, _keys(ALICE_PK, BOB_PK), _participants());
        _expectInvalidStateProof();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[2]), new MessageBlock[](0));
    }

    function test_U66_insufficientFinalityCannotPromoteTheFirstBlock() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(1, 3, _keys(ALICE_PK), _participants());
        _expectInvalidStateProof();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
    }

    // ---- U67 and U66's block-zero extension ----

    function test_U67_thresholdFinalBlockZeroIsPostable() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(0, 1, _keys(ALICE_PK, BOB_PK), _participants());
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
        assertEq(_onChainHash(), keccak256(abi.encode(states[0])));
    }

    function test_U67_unfinalizedBlockZeroIsNotPostable() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(0, 1, _keys(ALICE_PK), _participants());
        _expectInvalidStateProof();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
    }

    function test_U66_blockZeroAdditionWithTheUnionIsPostable() public {
        _joinDave();
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(0, 1, _keys(ALICE_PK, BOB_PK, DAVE_PK), _withDave());
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
        assertEq(_onChainHash(), keccak256(abi.encode(states[0])));
    }

    function test_U66_blockZeroAdditionMissingTheJoinerIsNotPostable() public {
        _joinDave();
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(0, 1, _keys(ALICE_PK, BOB_PK), _withDave());
        _expectInvalidStateProof();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
    }

    function test_U66_blockZeroRemovalWithTheUnionIsPostable() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(0, 1, _keys(ALICE_PK, BOB_PK), _alice());
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
        assertEq(_onChainHash(), keccak256(abi.encode(states[0])));
    }

    function test_U66_blockZeroRemovalMissingTheLeaverIsNotPostable() public {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory states) =
            _runFromGenesis(0, 1, _keys(ALICE_PK), _alice());
        _expectInvalidStateProof();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(states[0]), new MessageBlock[](0));
    }

    // ---- U109: no newer finalized state ----

    function test_U109_anchorBlockAloneHasNoNewerFinalizedState() public {
        (SignedBlock memory anchorBlock, StateSnapshot memory anchor) = _advanceOnce();
        MilestoneProof[] memory proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](1);
        proofs[0].blockConfirmations[0].signedBlock = anchorBlock;
        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionBlockHeightTooOld.selector, anchor.blockHeight, anchor.blockHeight)
        );
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(anchor), new MessageBlock[](0));
    }

    function test_U109_unfinalizedBlocksAfterTheAnchorAreNotATarget() public {
        (SignedBlock memory anchorBlock, StateSnapshot memory anchor) = _advanceOnce();
        // the last milestone starts at the anchor block; the next block is signed by its author only
        StateSnapshot memory next = _successor(anchor, anchor.blockHeight + 1, _participants());
        Block memory nextBlock = _blockAt(next, keccak256(anchorBlock.encodedBlock), vm.addr(ALICE_PK));
        MilestoneProof[] memory proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](2);
        proofs[0].blockConfirmations[0].signedBlock = anchorBlock;
        proofs[0].blockConfirmations[1] = _blockConfirmation(abi.encode(nextBlock), _keys(ALICE_PK));
        _expectInvalidStateProof();
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, _entry(next), new MessageBlock[](0));
        assertEq(_onChainHash(), keccak256(abi.encode(anchor)), "the chain stays at the anchor");
    }

    // ---- U118: a separate last milestone at the later final point ----

    /// D joins; the change milestone [1, 4] proves block 1 ({A, B, D} signed it); the last milestone [4, 5] proves
    /// block 4 by D's confirmation and A's signature on 4 and B's block 5. Returns the proof and the snapshots of 1
    /// and 4.
    function _overlappingChangeProof()
        private
        returns (MilestoneProof[] memory proofs, StateSnapshot memory changed, StateSnapshot memory later)
    {
        _joinDave();
        MilestoneProof[] memory change;
        StateSnapshot[] memory states;
        (change, states) = _runFromGenesis(1, 4, _keys(ALICE_PK, BOB_PK, DAVE_PK), _withDave());
        changed = states[0];
        later = states[3];
        SignedBlock memory four = change[0].blockConfirmations[3].signedBlock;
        StateSnapshot memory five = _successor(later, 5, _withDave());
        Block memory fiveBlock = _blockAt(five, keccak256(four.encodedBlock), vm.addr(BOB_PK));

        proofs = new MilestoneProof[](2);
        proofs[0] = change[0];
        proofs[1].blockConfirmations = new BlockConfirmation[](2);
        proofs[1].blockConfirmations[0].signedBlock = four;
        proofs[1].blockConfirmations[0].signatures = new bytes[](1);
        proofs[1].blockConfirmations[0].signatures[0] = _sign(DAVE_PK, four.encodedBlock);
        proofs[1].blockConfirmations[1] = _blockConfirmation(abi.encode(fiveBlock), _keys(BOB_PK));
    }

    function test_U118_separateLastMilestoneMakesTheLaterFinalPointTheTarget() public {
        (MilestoneProof[] memory proofs, StateSnapshot memory changed, StateSnapshot memory later) =
            _overlappingChangeProof();
        StateSnapshot[] memory entries = new StateSnapshot[](2);
        entries[0] = changed;
        entries[1] = later;
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, entries, new MessageBlock[](0));
        assertEq(_onChainHash(), keccak256(abi.encode(later)), "the later final point 4, not the change point 1");
    }

    function test_U118_changePointIsNotTheTargetOfTheOverlappingProof() public {
        (MilestoneProof[] memory proofs, StateSnapshot memory changed,) = _overlappingChangeProof();
        StateSnapshot[] memory entries = new StateSnapshot[](2);
        entries[0] = changed;
        entries[1] = changed;
        _expectInvalidStateProof(uint256(2), uint256(2));
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, entries, new MessageBlock[](0));
    }

    // ---- staging ----

    /// `count` linked blocks from `firstHeight` after the chain's genesis: the first (genesis-linked when it is block
    /// 0) commits a successor with `participants` and is signed by `firstSigners`, the rest are A's alone; returns
    /// the one-milestone proof and each block's snapshot
    function _runFromGenesis(
        uint256 firstHeight,
        uint256 count,
        uint256[] memory firstSigners,
        address[] memory participants
    ) private view returns (MilestoneProof[] memory proofs, StateSnapshot[] memory states) {
        StateSnapshot memory genesis = diamond.getStateSnapshot(CHANNEL);
        proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](count);
        states = new StateSnapshot[](count);
        bytes32 previousHash = firstHeight == 0 ? keccak256(abi.encode(genesis)) : keccak256("block 0");
        for (uint256 i = 0; i < count; i++) {
            states[i] = _successor(genesis, firstHeight + i, participants);
            Block memory b = _blockAt(states[i], previousHash, vm.addr(ALICE_PK));
            proofs[0].blockConfirmations[i] = _blockConfirmation(abi.encode(b), i == 0 ? firstSigners : _keys(ALICE_PK));
            previousHash = keccak256(abi.encode(b));
        }
    }

    /// `base`'s successor at `height` with `participants`, consuming the chain's inbound head
    function _successor(StateSnapshot memory base, uint256 height, address[] memory participants)
        private
        view
        returns (StateSnapshot memory next)
    {
        next = abi.decode(abi.encode(base), (StateSnapshot));
        ChannelBalance memory inboundHead = diamond.getChannelBalance(CHANNEL);
        next.snapshotData.participants = participants;
        next.snapshotData.stateMachineStateHash = keccak256(abi.encode("state", height, participants));
        next.snapshotData.latestInboundMessageBlockHash = inboundHead.latestInboundMessageBlockHash;
        next.snapshotData.latestInboundMessageBlockHeight = inboundHead.latestInboundMessageBlockHeight;
        next.blockHeight = height;
        next.timestamp = base.timestamp + 1 + height;
    }

    function _blockAt(StateSnapshot memory committed, bytes32 previousHash, address author)
        private
        pure
        returns (Block memory b)
    {
        b.transaction.header.channelId = CHANNEL;
        b.transaction.header.participant = author;
        b.transaction.header.forkId = committed.forkId;
        b.transaction.header.transactionCnt = committed.blockHeight;
        b.transaction.header.timestamp = committed.timestamp;
        b.previousBlockHash = previousHash;
        b.stateSnapshotHash = keccak256(abi.encode(committed));
    }

    /// one legitimate advance to the next height; returns the block that commits the new chain snapshot
    function _advanceOnce() private returns (SignedBlock memory anchorBlock, StateSnapshot memory anchor) {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, _participants(), _keys(ALICE_PK, BOB_PK));
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));
        anchor = diamond.getStateSnapshot(CHANNEL);
        assertEq(keccak256(abi.encode(anchor)), keccak256(abi.encode(snapshots[0])));
        anchorBlock = proofs[0].blockConfirmations[0].signedBlock;
    }

    /// D's JOIN lands on chain, pending above the snapshot's consumed inbound
    function _joinDave() private {
        StateSnapshot memory current = diamond.getStateSnapshot(CHANNEL);
        bytes memory encodedJoin = abi.encode(
            JoinChannel({
                channelId: CHANNEL,
                participant: vm.addr(DAVE_PK),
                deadlineTimestamp: block.timestamp + 1 days,
                balance: Balance({amount: 0, data: ""})
            })
        );
        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoin, signature: _sign(DAVE_PK, encodedJoin)});
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = _sign(ALICE_PK, encodedJoin);
        confirmation.signatures[1] = _sign(BOB_PK, encodedJoin);
        vm.prank(vm.addr(DAVE_PK));
        diamond.joinChannel(confirmation, keccak256(abi.encode(current)), current.forkId);
    }

    function _expectInvalidStateProof() private {
        _expectInvalidStateProof(uint256(1), uint256(1));
    }

    function _expectInvalidStateProof(uint256 proofCount, uint256 snapshotCount) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorInvalidStateProof.selector, diamond.getStateSnapshot(CHANNEL).forkId, proofCount, snapshotCount
            )
        );
    }

    function _onChainHash() private view returns (bytes32) {
        return keccak256(abi.encode(diamond.getStateSnapshot(CHANNEL)));
    }

    function _entry(StateSnapshot memory snapshot) private pure returns (StateSnapshot[] memory entries) {
        entries = new StateSnapshot[](1);
        entries[0] = snapshot;
    }

    function _participants() private pure returns (address[] memory participants) {
        participants = new address[](2);
        participants[0] = vm.addr(ALICE_PK);
        participants[1] = vm.addr(BOB_PK);
    }

    function _withDave() private pure returns (address[] memory participants) {
        participants = new address[](3);
        participants[0] = vm.addr(ALICE_PK);
        participants[1] = vm.addr(BOB_PK);
        participants[2] = vm.addr(DAVE_PK);
    }

    function _alice() private pure returns (address[] memory participants) {
        participants = new address[](1);
        participants[0] = vm.addr(ALICE_PK);
    }

    function _keys(uint256 first) private pure returns (uint256[] memory keys) {
        keys = new uint256[](1);
        keys[0] = first;
    }

    function _keys(uint256 first, uint256 second) private pure returns (uint256[] memory keys) {
        keys = new uint256[](2);
        keys[0] = first;
        keys[1] = second;
    }

    function _keys(uint256 first, uint256 second, uint256 third) private pure returns (uint256[] memory keys) {
        keys = new uint256[](3);
        keys[0] = first;
        keys[1] = second;
        keys[2] = third;
    }
}
