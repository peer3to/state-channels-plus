pragma solidity ^0.8.8;

import {AStateMachine} from "../../../contracts/V1/AStateMachine.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    ErrorInvalidStateProof,
    ErrorWithdrawalFailed,
    RaceConditionBlockHeightTooOld
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DiamondHarness} from "../harness/DiamondHarness.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// Seeds the on-chain snapshot so the same-fork guards can be met one at a
/// time. `updateStateSnapshotSameFork` itself is untouched production code; the
/// facet only needs a real `UtilityFacet` because it reaches the snapshot
/// comparison through a plain call.
contract SameForkSnapshotHarness is StateSnapshotFacet {
    constructor() {
        utilityFacetAddress = address(new UtilityFacet());
    }

    function seedStateSnapshot(bytes32 channelId, StateSnapshot memory snapshot) external {
        stateSnapshots[channelId] = snapshot;
    }
}

/// Reaches the outbound-apply loop at its own entry point and fails exactly one
/// message. `_processOutboundMessage` still runs as written: the message type
/// is not EXIT, so it dispatches to `_processCustomOutboundMessage`, the
/// `internal virtual` hook an application implements for its own message types
/// — returning false there is what that hook is for, not a stand-in for the
/// code under test. The guard being tested (`require(success, ...)` and the
/// `i`/`j` bookkeeping around it) is production code. A real EXIT message
/// cannot fail here: `withdrawAssetsComposable` forwards to the consumer
/// facet, and the example consumer's `withdraw` always returns true.
contract OutboundMessageApplyHarness is StateSnapshotFacet {
    address internal immutable failingParticipant;

    constructor(AStateMachine stateMachine, address participantWhoseWithdrawalFails) {
        stateMachineImplementation = stateMachine;
        failingParticipant = participantWhoseWithdrawalFails;
    }

    function applyOutboundMessageBlocks(
        bytes32 channelId,
        MessageBlock[] memory outboundMessageBlocks,
        SnapshotData memory newSnapshotData
    ) external {
        _applyOutboundMessageBlocks(channelId, outboundMessageBlocks, newSnapshotData);
    }

    function _processCustomOutboundMessage(Message memory message) internal view override returns (bool) {
        return message.participant != failingParticipant;
    }
}

// test naming: test_<targetFunction>_<property>
contract StateSnapshotFacetSameForkTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant OUTSIDER_PK = 0x0BAD;
    bytes32 internal constant CHANNEL_ID = keccak256("same-fork-channel");
    bytes32 internal constant SEEDED_FORK_ID = keccak256("same-fork-seeded-fork");
    // distinct and non-zero on both sides, so a swapped payload fails the oracle
    uint256 internal constant ON_CHAIN_BLOCK_HEIGHT = 5;
    uint256 internal constant SUBMITTED_BLOCK_HEIGHT = 3;
    bytes32 internal constant CUSTOM_MESSAGE_TYPE = keccak256("SAME_FORK_TEST_OUTBOUND_MESSAGE");

    function setUp() public {
        diamond = deployDiamond();
        _openChannel(CHANNEL_ID, _privateKeys());
    }

    // a snapshot that is behind the one already on chain is rejected, and the
    // revert must report the on-chain height and the submitted height in that
    // order
    function test_updateStateSnapshotSameFork_submittedSnapshotOlderThanOnChain_revertsCarryingBothBlockHeights()
        public
    {
        SameForkSnapshotHarness harness = new SameForkSnapshotHarness();

        StateSnapshot memory onChainSnapshot;
        onChainSnapshot.forkId = SEEDED_FORK_ID;
        onChainSnapshot.blockHeight = ON_CHAIN_BLOCK_HEIGHT;
        harness.seedStateSnapshot(CHANNEL_ID, onChainSnapshot);

        StateSnapshot memory staleSnapshot;
        staleSnapshot.forkId = SEEDED_FORK_ID;
        staleSnapshot.blockHeight = SUBMITTED_BLOCK_HEIGHT;
        StateSnapshot[] memory milestoneSnapshots = new StateSnapshot[](1);
        milestoneSnapshots[0] = staleSnapshot;

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionBlockHeightTooOld.selector, ON_CHAIN_BLOCK_HEIGHT, SUBMITTED_BLOCK_HEIGHT
            )
        );
        harness.updateStateSnapshotSameFork(
            CHANNEL_ID, new MilestoneProof[](0), milestoneSnapshots, new MessageBlock[](0)
        );
    }

    // one proof for two snapshots cannot describe a milestone chain, so
    // verification fails and the revert must report the fork under advance plus
    // both lengths, which are deliberately different
    function test_updateStateSnapshotSameFork_proofCountDiffersFromSnapshotCount_revertsCarryingForkIdAndBothCounts()
        public
    {
        StateSnapshot memory currentSnapshot = diamond.getStateSnapshot(CHANNEL_ID);

        StateSnapshot memory newerSnapshot;
        newerSnapshot.snapshotData = currentSnapshot.snapshotData;
        newerSnapshot.forkId = currentSnapshot.forkId;
        newerSnapshot.blockHeight = currentSnapshot.blockHeight + 1;
        newerSnapshot.timestamp = currentSnapshot.timestamp + 1;

        StateSnapshot[] memory milestoneSnapshots = new StateSnapshot[](2);
        milestoneSnapshots[0] = currentSnapshot;
        milestoneSnapshots[1] = newerSnapshot;

        vm.expectRevert(
            abi.encodeWithSelector(ErrorInvalidStateProof.selector, currentSnapshot.forkId, uint256(1), uint256(2))
        );
        diamond.updateStateSnapshotSameFork(
            CHANNEL_ID, new MilestoneProof[](1), milestoneSnapshots, new MessageBlock[](0)
        );
    }

    // the failing message sits at block 1, message 2 behind three messages that
    // succeed, so the reported indices can only be right if the loop counters
    // are reported the right way round
    function test_applyOutboundMessageBlocks_messageProcessingFails_revertsCarryingBothIndicesAndParticipant() public {
        address alice = vm.addr(ALICE_PK);
        address bob = vm.addr(BOB_PK);
        address failingParticipant = address(0xFA11);
        OutboundMessageApplyHarness harness = new OutboundMessageApplyHarness(
            new MathStateMachine(SM_GAS_LIMIT, MAX_CHANNEL_PARTICIPANTS), failingParticipant
        );

        MessageBlock[] memory outboundMessageBlocks = new MessageBlock[](2);
        outboundMessageBlocks[0].messages = new Message[](1);
        outboundMessageBlocks[0].messages[0] = _zeroValueMessage(alice);
        outboundMessageBlocks[1].messages = new Message[](3);
        outboundMessageBlocks[1].messages[0] = _zeroValueMessage(alice);
        outboundMessageBlocks[1].messages[1] = _zeroValueMessage(bob);
        outboundMessageBlocks[1].messages[2] = _zeroValueMessage(failingParticipant);

        SnapshotData memory newSnapshotData;

        vm.expectRevert(
            abi.encodeWithSelector(ErrorWithdrawalFailed.selector, uint256(1), uint256(2), failingParticipant)
        );
        harness.applyOutboundMessageBlocks(CHANNEL_ID, outboundMessageBlocks, newSnapshotData);
    }

    /// Carries no value, so every message that succeeds leaves total
    /// withdrawals equal to the channel's (zero) deposits and the
    /// withdrawals-cap guard cannot fire before the index under test.
    // every milestone starts below the chain height and none sits at it, so nothing is proven above the
    // chain snapshot; a forged newer snapshot behind such a proof must not be adopted by anyone
    function test_updateStateSnapshotSameFork_everyMilestoneBelowChainHeight_forgedNewerSnapshot_revertsInvalidStateProof(
    ) public {
        StateSnapshot memory current = _advanceOnce();
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) = _allSkippedProof(current);
        StateSnapshot memory forged = snapshots[0];
        address[] memory outsider = new address[](1);
        outsider[0] = vm.addr(OUTSIDER_PK);
        forged.snapshotData.participants = outsider;
        forged.blockHeight = current.blockHeight + 10;
        forged.timestamp = current.timestamp + 10;
        snapshots[0] = forged;

        vm.expectRevert(abi.encodeWithSelector(ErrorInvalidStateProof.selector, current.forkId, uint256(1), uint256(1)));
        vm.prank(vm.addr(OUTSIDER_PK));
        diamond.updateStateSnapshotSameFork(CHANNEL_ID, proofs, snapshots, new MessageBlock[](0));
        assertEq(keccak256(abi.encode(diamond.getStateSnapshot(CHANNEL_ID))), keccak256(abi.encode(current)));
    }

    // the run that holds the chain snapshot needs no threshold, so it proves nothing newer than that snapshot: a
    // proof that only reaches the start, alone or with an author-signed block after it, posts no newer snapshot
    function test_updateStateSnapshotSameFork_proofOnlyReachingTheStart_revertsInvalidStateProof() public {
        StateSnapshot memory current = _advanceOnce();
        for (uint256 withTail = 0; withTail < 2; withTail++) {
            (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) = _startRunProof(current, withTail == 1);
            vm.expectRevert(
                abi.encodeWithSelector(ErrorInvalidStateProof.selector, current.forkId, uint256(1), uint256(1))
            );
            diamond.updateStateSnapshotSameFork(CHANNEL_ID, proofs, snapshots, new MessageBlock[](0));
            assertEq(keccak256(abi.encode(diamond.getStateSnapshot(CHANNEL_ID))), keccak256(abi.encode(current)));
        }
    }

    /// one author-signed run from the block that commits `current`, with one more block when `withTail`; its entry
    /// is the newer snapshot the next block would commit
    function _startRunProof(StateSnapshot memory current, bool withTail)
        internal
        pure
        returns (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots)
    {
        StateSnapshot memory next = abi.decode(abi.encode(current), (StateSnapshot));
        next.snapshotData.stateMachineStateHash = keccak256("next state");
        next.blockHeight = current.blockHeight + 1;
        next.timestamp = current.timestamp + 1;

        Block memory startBlock;
        startBlock.transaction.header.channelId = CHANNEL_ID;
        startBlock.transaction.header.participant = vm.addr(ALICE_PK);
        startBlock.transaction.header.forkId = current.forkId;
        startBlock.transaction.header.transactionCnt = current.blockHeight;
        startBlock.transaction.header.timestamp = current.timestamp;
        startBlock.stateSnapshotHash = keccak256(abi.encode(current));
        bytes memory encodedStart = abi.encode(startBlock);

        proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](withTail ? 2 : 1);
        proofs[0].blockConfirmations[0] = _blockConfirmation(encodedStart, _alice());
        if (withTail) {
            Block memory tail = startBlock;
            tail.transaction.header.transactionCnt = next.blockHeight;
            tail.transaction.header.timestamp = next.timestamp;
            tail.previousBlockHash = keccak256(encodedStart);
            tail.stateSnapshotHash = keccak256(abi.encode(next));
            proofs[0].blockConfirmations[1] = _blockConfirmation(abi.encode(tail), _alice());
        }
        snapshots = new StateSnapshot[](1);
        snapshots[0] = next;
    }

    function _alice() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](1);
        pks[0] = ALICE_PK;
    }

    // ---- block zero from the genesis: postable only when threshold-final ----

    function test_updateStateSnapshotSameFork_blockZero_postsOnlyWhenFinal() public {
        StateSnapshot memory genesis = diamond.getStateSnapshot(CHANNEL_ID);
        uint256[] memory authorOnly = new uint256[](1);
        authorOnly[0] = ALICE_PK;
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) = _blockZeroProof(genesis, authorOnly);
        vm.expectRevert(abi.encodeWithSelector(ErrorInvalidStateProof.selector, genesis.forkId, uint256(1), uint256(1)));
        diamond.updateStateSnapshotSameFork(CHANNEL_ID, proofs, snapshots, new MessageBlock[](0));

        (proofs, snapshots) = _blockZeroProof(genesis, _privateKeys());
        diamond.updateStateSnapshotSameFork(CHANNEL_ID, proofs, snapshots, new MessageBlock[](0));
        assertEq(keccak256(abi.encode(diamond.getStateSnapshot(CHANNEL_ID))), keccak256(abi.encode(snapshots[0])));
    }

    /// one milestone with the genesis-linked block 0, committing the genesis successor and signed by `signers`;
    /// that successor is the snapshot the update posts
    function _blockZeroProof(StateSnapshot memory genesis, uint256[] memory signers)
        internal
        pure
        returns (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots)
    {
        StateSnapshot memory blockZeroSnapshot = abi.decode(abi.encode(genesis), (StateSnapshot));
        blockZeroSnapshot.snapshotData.stateMachineStateHash = keccak256("block zero state");
        blockZeroSnapshot.timestamp = genesis.timestamp + 1;

        Block memory blockZero;
        blockZero.transaction.header.channelId = CHANNEL_ID;
        blockZero.transaction.header.participant = vm.addr(signers[0]);
        blockZero.transaction.header.forkId = genesis.forkId;
        blockZero.transaction.header.timestamp = blockZeroSnapshot.timestamp;
        blockZero.previousBlockHash = keccak256(abi.encode(genesis));
        blockZero.stateSnapshotHash = keccak256(abi.encode(blockZeroSnapshot));

        proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](1);
        proofs[0].blockConfirmations[0] = _blockConfirmation(abi.encode(blockZero), signers);
        snapshots = new StateSnapshot[](1);
        snapshots[0] = blockZeroSnapshot;
    }

    /// one legitimate same-fork advance, so the chain height is above 0 and a lower milestone can be skipped
    function _advanceOnce() internal returns (StateSnapshot memory current) {
        address[] memory participants = new address[](2);
        participants[0] = vm.addr(ALICE_PK);
        participants[1] = vm.addr(BOB_PK);
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL_ID, participants, _privateKeys());
        diamond.updateStateSnapshotSameFork(CHANNEL_ID, proofs, snapshots, new MessageBlock[](0));
        current = diamond.getStateSnapshot(CHANNEL_ID);
    }

    /// one unsigned milestone whose only block is below `current`'s height, claiming `current` as its snapshot
    function _allSkippedProof(StateSnapshot memory current)
        internal
        pure
        returns (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots)
    {
        Block memory below;
        below.transaction.header.channelId = CHANNEL_ID;
        below.transaction.header.forkId = current.forkId;
        below.transaction.header.transactionCnt = current.blockHeight - 1;
        proofs = new MilestoneProof[](1);
        proofs[0].blockConfirmations = new BlockConfirmation[](1);
        proofs[0].blockConfirmations[0].signedBlock = SignedBlock({encodedBlock: abi.encode(below), signature: ""});
        proofs[0].blockConfirmations[0].signatures = new bytes[](0);
        snapshots = new StateSnapshot[](1);
        snapshots[0] = abi.decode(abi.encode(current), (StateSnapshot));
    }

    function _zeroValueMessage(address participant) internal pure returns (Message memory message) {
        message.messageType = CUSTOM_MESSAGE_TYPE;
        message.participant = participant;
        message.balance = Balance({amount: 0, data: ""});
    }

    function _privateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }
}
