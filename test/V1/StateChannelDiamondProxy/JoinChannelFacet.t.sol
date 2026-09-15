pragma solidity ^0.8.8;

import {Test} from "../../../lib/forge-std/src/Test.sol";
import {JoinChannelFacet} from "../../../contracts/V1/StateChannelDiamondProxy/JoinChannelFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {
    ErrorJoinChannelAtomicFailure,
    ErrorJoinChannelConfirmationNotThresholdSigned,
    ErrorJoinChannelInvalidSignature,
    ErrorJoinChannelParticipantAlreadyExists,
    ErrorTopUpBalanceParticipantNotFound,
    ErrorTopUpBalanceParticipantSlashed,
    RaceConditionSnapshotForkMismatch
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

contract JoinChannelFacetHarness is JoinChannelFacet {
    /// The failure payload the stub injects. Deliberately unreachable for a
    /// real single-join batch (index 0, the joining participant), so a test can
    /// tell "bubbled unchanged" from "rebuilt by the facet".
    uint256 public constant STUB_FAILURE_INDEX = 7;
    address public constant STUB_FAILURE_PARTICIPANT = address(0xDEAD);

    bool public depositCalled;
    bool public depositShouldFail;
    address public depositedParticipant;

    constructor() {
        utilityFacetAddress = address(new UtilityFacet());
    }

    function seedChannel(bytes32 channelId, bytes32 forkId, address[] memory participants, address slashedParticipant)
        external
    {
        stateSnapshots[channelId].forkId = forkId;
        stateSnapshots[channelId].snapshotData.participants = participants;
        disputeData[channelId].onChainSlashes.push(OnChainSlash(slashedParticipant, block.timestamp));
    }

    function isForkDisputed(bytes32, bytes32) external pure returns (bool) {
        return false;
    }

    function setDepositShouldFail(bool shouldFail) external {
        depositShouldFail = shouldFail;
    }

    function depositAssetsComposable(JoinChannel[] memory joinChannels, bool)
        external
        returns (
            MessageBlock memory messageBlock,
            Balance memory newTotalDeposits,
            JoinChannel[] memory successfulJoins
        )
    {
        if (depositShouldFail) {
            revert ErrorJoinChannelAtomicFailure(STUB_FAILURE_INDEX, STUB_FAILURE_PARTICIPANT);
        }
        depositCalled = true;
        depositedParticipant = joinChannels[0].participant;
        successfulJoins = joinChannels;
        return (messageBlock, newTotalDeposits, successfulJoins);
    }

    /// Exposes the internal snapshot reads so the facet's storage effects can be asserted directly.
    function getStateSnapshot(bytes32 channelId) external view returns (StateSnapshot memory) {
        return _getStateSnapshot(channelId);
    }

    function getOnChainThresholdSet(bytes32 channelId) external view returns (address[] memory) {
        return _getOnChainThresholdSet(channelId);
    }
}

// test naming: test_<targetFunction>_<property>
contract JoinChannelFacetTest is Test {
    JoinChannelFacetHarness internal harness;

    uint256 internal constant ELIGIBLE_PK = 0xA11CE;
    uint256 internal constant SLASHED_PK = 0xB0B;
    uint256 internal constant JOINER_PK = 0xCAFE;
    bytes32 internal constant CHANNEL_ID = keccak256("join-after-slash");
    bytes32 internal constant FORK_ID = keccak256("join-after-slash-fork");
    bytes32 internal constant THRESHOLD_CHANNEL_ID = keccak256("join-threshold-set-of-two");
    bytes32 internal constant THRESHOLD_FORK_ID = keccak256("join-threshold-set-of-two-fork");

    function setUp() public {
        harness = new JoinChannelFacetHarness();

        address[] memory participants = new address[](2);
        participants[0] = vm.addr(ELIGIBLE_PK);
        participants[1] = vm.addr(SLASHED_PK);
        harness.seedChannel(CHANNEL_ID, FORK_ID, participants, participants[1]);
    }

    function test_joinChannel_slashedParticipantCannotVetoLaterJoin() public {
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoinChannel, signature: _sign(JOINER_PK, encodedJoinChannel)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        address[] memory thresholdSet = harness.getOnChainThresholdSet(CHANNEL_ID);
        assertEq(thresholdSet.length, 1);
        assertEq(thresholdSet[0], vm.addr(ELIGIBLE_PK));
        assertTrue(harness.depositCalled());
        assertEq(harness.depositedParticipant(), joinChannel.participant);
    }

    function test_topUpBalance_slashedParticipantRejected() public {
        address slashedParticipant = vm.addr(SLASHED_PK);
        JoinChannel memory topUp = JoinChannel({
            channelId: CHANNEL_ID,
            participant: slashedParticipant,
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 125, data: ""})
        });
        bytes memory encodedTopUp = abi.encode(topUp);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedTopUp, signature: _sign(SLASHED_PK, encodedTopUp)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedTopUp);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        vm.expectRevert(abi.encodeWithSelector(ErrorTopUpBalanceParticipantSlashed.selector, slashedParticipant));
        vm.prank(slashedParticipant);
        harness.topUpBalance(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        assertFalse(harness.depositCalled());
    }

    function test_joinChannel_wrongForkPinRejected() public {
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoinChannel, signature: _sign(JOINER_PK, encodedJoinChannel)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionSnapshotForkMismatch.selector, snapshot.forkId, keccak256("wrong-fork"))
        );
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), keccak256("wrong-fork"));

        assertFalse(harness.depositCalled());
    }

    function test_topUpBalance_unknownParticipantRejected() public {
        JoinChannel memory topUp = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 125, data: ""})
        });
        bytes memory encodedTopUp = abi.encode(topUp);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedTopUp, signature: _sign(JOINER_PK, encodedTopUp)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedTopUp);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        vm.expectRevert(
            abi.encodeWithSelector(ErrorTopUpBalanceParticipantNotFound.selector, CHANNEL_ID, topUp.participant)
        );
        vm.prank(topUp.participant);
        harness.topUpBalance(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        assertFalse(harness.depositCalled());
    }

    function test_joinChannel_invalidParticipantSignatureRejected() public {
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel = SignedJoinChannel({
            encodedJoinChannel: encodedJoinChannel,
            signature: _sign(ELIGIBLE_PK, encodedJoinChannel)
        });
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        // the confirmation is signed by ELIGIBLE, so the recovered signer is not the declared participant
        vm.expectRevert(
            abi.encodeWithSelector(ErrorJoinChannelInvalidSignature.selector, vm.addr(JOINER_PK), vm.addr(ELIGIBLE_PK))
        );
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        assertFalse(harness.depositCalled());
    }

    function test_joinChannel_snapshotParticipantRejected() public {
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(ELIGIBLE_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel = SignedJoinChannel({
            encodedJoinChannel: encodedJoinChannel,
            signature: _sign(ELIGIBLE_PK, encodedJoinChannel)
        });
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        vm.expectRevert(
            abi.encodeWithSelector(ErrorJoinChannelParticipantAlreadyExists.selector, CHANNEL_ID, vm.addr(ELIGIBLE_PK))
        );
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        assertFalse(harness.depositCalled());
    }

    function test_joinChannel_exactDeadlineAccepted() public {
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoinChannel, signature: _sign(JOINER_PK, encodedJoinChannel)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        assertTrue(harness.depositCalled());
        assertEq(harness.depositedParticipant(), joinChannel.participant);
    }

    /// Facet-level propagation shape only: a revert from the composable deposit
    /// reaches the caller unchanged. The payload the real loop builds is proven
    /// against the deployed diamond in StateChannelManagerProxyDeposit.t.sol.
    function test_joinChannel_depositRevertBubblesUnchanged() public {
        JoinChannel memory joinChannel = JoinChannel({
            channelId: CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoinChannel, signature: _sign(JOINER_PK, encodedJoinChannel)});
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        harness.setDepositShouldFail(true);
        StateSnapshot memory snapshot = harness.getStateSnapshot(CHANNEL_ID);
        // neither operand is one this join could produce, so an unchanged bubble
        // is distinguishable from a payload the facet rebuilt itself
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorJoinChannelAtomicFailure.selector, harness.STUB_FAILURE_INDEX(), harness.STUB_FAILURE_PARTICIPANT()
            )
        );
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), FORK_ID);

        assertFalse(harness.depositCalled());
        assertEq(harness.depositedParticipant(), address(0));
    }

    function test_joinChannel_confirmationNotThresholdSignedRejected() public {
        // a second channel whose two participants are both eligible (nothing is
        // slashed on it), so the threshold set holds 2 addresses
        address[] memory participants = new address[](2);
        participants[0] = vm.addr(ELIGIBLE_PK);
        participants[1] = vm.addr(SLASHED_PK);
        harness.seedChannel(THRESHOLD_CHANNEL_ID, THRESHOLD_FORK_ID, participants, address(0));

        JoinChannel memory joinChannel = JoinChannel({
            channelId: THRESHOLD_CHANNEL_ID,
            participant: vm.addr(JOINER_PK),
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 500, data: ""})
        });
        bytes memory encodedJoinChannel = abi.encode(joinChannel);

        JoinChannelConfirmation memory confirmation;
        confirmation.signedJoinChannel =
            SignedJoinChannel({encodedJoinChannel: encodedJoinChannel, signature: _sign(JOINER_PK, encodedJoinChannel)});
        // only one of the two threshold participants countersigned, so the
        // confirmation stays under threshold: required 2, supplied 1
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(ELIGIBLE_PK, encodedJoinChannel);

        StateSnapshot memory snapshot = harness.getStateSnapshot(THRESHOLD_CHANNEL_ID);
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorJoinChannelConfirmationNotThresholdSigned.selector, joinChannel.participant, uint256(2), uint256(1)
            )
        );
        vm.prank(joinChannel.participant);
        harness.joinChannel(confirmation, keccak256(abi.encode(snapshot)), THRESHOLD_FORK_ID);

        assertFalse(harness.depositCalled());
    }

    function _sign(uint256 privateKey, bytes memory encodedData) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(encodedData)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
