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
        OutboundMessageApplyHarness harness =
            new OutboundMessageApplyHarness(new MathStateMachine(SM_GAS_LIMIT), failingParticipant);

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
