pragma solidity ^0.8.8;

import {Test} from "forge-std/Test.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {StateSnapshotFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateSnapshotFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import {MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";

contract InboundHeadPruningHarness is DisputeFraudProofFacet, DisputeVerificationFacet, StateSnapshotFacet {
    constructor() {
        evidenceTime = 10;
        utilityFacetAddress = address(new UtilityFacet());
        stateProofFacetAddress = address(new StateProofFacet());
        disputeVerificationFacetAddress = address(this);
        stateMachineImplementation = new MathStateMachine(3_000_000, 32);
    }

    /// an inbound block as the chain persists it, with one JOIN of `joiner`; it becomes the channel's inbound head
    function seedInboundJoin(bytes32 channelId, bytes32 hash, bytes32 previous, uint256 height, address joiner)
        external
    {
        MessageBlock storage inbound = inboundMessageBlockMap[channelId][hash];
        inbound.timestamp = block.timestamp;
        inbound.previousBlockHash = previous;
        inbound.blockHeight = height;
        Balance memory balance = Balance({amount: 0, data: ""});
        inbound.messages
            .push(
                Message({
                    messageType: MESSAGE_TYPE_JOIN,
                    participant: joiner,
                    balance: balance,
                    data: abi.encode(
                        JoinChannel({channelId: channelId, participant: joiner, deadlineTimestamp: 0, balance: balance})
                    )
                })
            );
        channelBalances[channelId].latestInboundMessageBlockHash = hash;
        channelBalances[channelId].latestInboundMessageBlockHeight = height;
    }

    /// what a landed `_updateStateSnapshot` writes for the participant set and inbound head
    function landSnapshot(bytes32 channelId, address[] memory participants, bytes32 inboundHash, uint256 inboundHeight)
        external
    {
        SnapshotData storage data = stateSnapshots[channelId].snapshotData;
        delete data.participants;
        for (uint256 i = 0; i < participants.length; i++) {
            data.participants.push(participants[i]);
        }
        data.latestInboundMessageBlockHash = inboundHash;
        data.latestInboundMessageBlockHeight = inboundHeight;
    }

    /// an expired dispute window on `forkId`, as `uploadDispute` opens it
    function seedWindow(bytes32 channelId, bytes32 forkId) external {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        window.forkId = forkId;
        window.evidence.creationTimestamp = block.timestamp;
        window.evidence.lastEvidenceSubmissionTimestamp = block.timestamp;
        disputeData[channelId].disputedForks.push(forkId);
    }

    function clearStorage(bytes32 channelId, bytes32 snapshotInboundHash, bool isChannelClosed) external {
        _clearStorage(channelId, snapshotInboundHash, isChannelClosed);
    }

    function hasInboundBlock(bytes32 channelId, bytes32 hash) external view returns (bool) {
        return _hasInboundMessageBlock(channelId, hash);
    }

    function inboundBlockHeight(bytes32 channelId, bytes32 hash) external view returns (uint256) {
        return inboundMessageBlockMap[channelId][hash].blockHeight;
    }

    function historicThresholdSet(Dispute memory dispute) external view returns (address[] memory) {
        return _getHistoricThresholdSet(dispute);
    }
}

/// An open channel's prune keeps the snapshot's inbound head, so a later reduction, a dispute anchored at it and
/// the next inbound block all read its real height. Closing the channel prunes the head too.
contract InboundHeadPruningTest is Test, StateChannelManagerEvents {
    bytes32 internal constant CHANNEL_ID = keccak256("inbound-head-pruning");
    bytes32 internal constant FORK_ID = keccak256("inbound-head-pruning-fork");
    bytes32 internal constant H1 = keccak256("inbound 1");
    bytes32 internal constant H2 = keccak256("inbound 2");
    bytes32 internal constant H3 = keccak256("inbound 3");

    address internal a = address(0xA11CE);
    address internal b = address(0xB0B);
    address internal c = address(0xC0FFEE);

    InboundHeadPruningHarness internal harness;

    function setUp() public {
        vm.warp(1_000_000);
        harness = new InboundHeadPruningHarness();
        harness.seedInboundJoin(CHANNEL_ID, H1, bytes32(0), 1, a);
        harness.seedInboundJoin(CHANNEL_ID, H2, H1, 2, b);
    }

    function test_clearStorage_openChannel_keepsTheSnapshotInboundHeadAndPrunesTheBlocksBelow() public {
        harness.seedInboundJoin(CHANNEL_ID, H3, H2, 3, c);

        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(CHANNEL_ID, H1);
        harness.clearStorage(CHANNEL_ID, H2, false);

        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H1), "below the head pruned");
        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H2), "snapshot head kept");
        assertEq(harness.inboundBlockHeight(CHANNEL_ID, H2), 2, "snapshot head keeps its height");
        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H3), "above the head kept");
    }

    function test_clearStorage_closedChannel_prunesTheSnapshotInboundHeadToo() public {
        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(CHANNEL_ID, H2);
        harness.clearStorage(CHANNEL_ID, H2, true);

        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H1));
        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H2));
    }

    function test_clearStorage_openChannel_nextPrunePrunesThePreviouslyKeptHead() public {
        harness.clearStorage(CHANNEL_ID, H2, false);
        harness.seedInboundJoin(CHANNEL_ID, H3, H2, 3, c);

        harness.clearStorage(CHANNEL_ID, H3, false);

        assertFalse(harness.hasInboundBlock(CHANNEL_ID, H2), "the earlier kept head pruned");
        assertTrue(harness.hasInboundBlock(CHANNEL_ID, H3), "the new snapshot head kept");
    }

    function test_clearStorage_openChannelWithoutInboundBlocks_prunesNothing() public {
        bytes32 emptyChannel = keccak256("no inbound blocks");

        vm.expectEmit(address(harness));
        emit ChannelStorageCleared(emptyChannel, bytes32(0));
        harness.clearStorage(emptyChannel, bytes32(0), false);
    }

    /// The reduction after a prune used to read height 0 from the deleted head, so the reduced fork could chain no
    /// later inbound block.
    function test_reduce_afterOpenChannelPrune_readsTheSnapshotInboundHeadHeight() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);
        vm.warp(block.timestamp + 5);
        harness.seedWindow(CHANNEL_ID, FORK_ID);

        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;
        ReduceOutput memory out = harness.reduce(disputes);

        assertEq(out.latestInboundMessageBlockHash, H2);
        assertEq(out.latestInboundMessageBlockHeight, 2);
    }

    /// A dispute anchored at a pruned snapshot's head below the chain head claims the head's real height.
    function test_isDisputeInboundHashValid_afterOpenChannelPrune_acceptsTheSnapshotHeadAtItsHeight() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a, b), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);
        harness.seedInboundJoin(CHANNEL_ID, H3, H2, 3, c);

        Dispute memory dispute = _disputeAt(H2, 2);
        assertTrue(harness.isDisputeInboundHashValid(dispute), "real height accepted");
        dispute.input.lastInboundMessageBlockHeight = 0;
        assertFalse(harness.isDisputeInboundHashValid(dispute), "zero height refused");
    }

    /// The kept head's JOINs are consumed by the snapshot: a joiner who left since is not counted as pending.
    function test_historicThresholdSet_afterOpenChannelPrune_countsNoJoinOfTheKeptHead() public {
        harness.landSnapshot(CHANNEL_ID, _addresses(a), H2, 2);
        harness.clearStorage(CHANNEL_ID, H2, false);

        address[] memory atHead = harness.historicThresholdSet(_disputeAt(H2, 2));
        assertEq(abi.encode(atHead), abi.encode(_addresses(a)), "b left after its JOIN was consumed");

        harness.seedInboundJoin(CHANNEL_ID, H3, H2, 3, c);
        address[] memory aboveHead = harness.historicThresholdSet(_disputeAt(H3, 3));
        assertEq(abi.encode(aboveHead), abi.encode(_addresses(a, c)), "a JOIN above the head is pending");
    }

    function _disputeAt(bytes32 inboundHash, uint256 inboundHeight) internal pure returns (Dispute memory dispute) {
        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = FORK_ID;
        dispute.input.latestInboundMessageBlockHash = inboundHash;
        dispute.input.lastInboundMessageBlockHeight = inboundHeight;
    }

    function _addresses(address first) internal pure returns (address[] memory addresses) {
        addresses = new address[](1);
        addresses[0] = first;
    }

    function _addresses(address first, address second) internal pure returns (address[] memory addresses) {
        addresses = new address[](2);
        addresses[0] = first;
        addresses[1] = second;
    }
}
