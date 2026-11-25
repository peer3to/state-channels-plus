pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import {
    ErrorAtLeastTwoParticipantsRequired,
    ErrorDuplicateParticipant,
    ErrorJoinChannelAtomicFailure,
    ErrorTooManyParticipants,
    RaceConditionChannelAlreadyOpen,
    RaceConditionOpenChannelExpired
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {SelectiveDepositConsumerFacet} from "../harness/SelectiveDepositConsumerFacet.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract StateChannelManagerProxyOpenTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant SIGNER_PK = 0xA11CE;
    uint256 internal constant SECOND_SIGNER_PK = 0xB0B;
    bytes32 internal constant CHANNEL_ID = keccak256("duplicate-participants");
    bytes32 internal constant REJECTED_OPEN_CHANNEL_ID = keccak256("rejected-open");
    bytes32 internal constant DEADLINE_CHANNEL_ID = keccak256("open-deadline");
    // a deadline far from the default test timestamp, so the warp targets are unambiguous
    uint256 internal constant OPEN_DEADLINE = 1_000_000;

    function setUp() public {
        diamond = deployDiamond();
    }

    // open() must reject duplicate participants
    function test_open_duplicateParticipants_reverts() public {
        address signer = vm.addr(SIGNER_PK);
        bytes memory sig = _sign(SIGNER_PK, _encodeOpenChannel(signer, signer));

        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = _encodeOpenChannel(signer, signer);
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = sig;
        confirmation.signatures[1] = sig;

        vm.expectRevert(abi.encodeWithSelector(ErrorDuplicateParticipant.selector, signer));
        diamond.open(confirmation);
    }

    function test_open_inboundJoinMessageDataIsCanonicalJoinEncoding() public {
        OpenChannelConfirmation memory confirmation = _deadlineOpenConfirmation();
        OpenChannel memory terms = abi.decode(confirmation.encodedOpenChannel, (OpenChannel));
        vm.recordLogs();
        diamond.open(confirmation);
        MessageBlock memory inbound = abi.decode(
            _logData(
                vm.getRecordedLogs(), StateChannelManagerEvents.InboundMessagesProcessed.selector, DEADLINE_CHANNEL_ID
            ),
            (MessageBlock)
        );
        assertEq(inbound.messages.length, 2, "inbound join count changed");
        for (uint256 j = 0; j < inbound.messages.length; j++) {
            assertEq(inbound.messages[j].messageType, MESSAGE_TYPE_JOIN, "inbound message is not a join");
            JoinChannel memory expected = JoinChannel({
                channelId: terms.channelId,
                participant: terms.participants[j],
                deadlineTimestamp: terms.deadlineTimestamp,
                balance: terms.balances[j]
            });
            assertEq(
                keccak256(inbound.messages[j].data),
                keccak256(abi.encode(expected)),
                "inbound join data does not encode the admitted join"
            );
        }
    }

    // fewer than two participants is rejected before any deposit: with a zero
    // amount the selective consumer would otherwise fail the deposit first
    function test_open_oneParticipant_revertsBeforeAnyDeposit() public {
        SelectiveDepositConsumerFacet selectiveConsumer = new SelectiveDepositConsumerFacet();
        vm.etch(address(consumerFacet), address(selectiveConsumer).code);
        uint256[] memory participantPrivateKeys = new uint256[](1);
        participantPrivateKeys[0] = SIGNER_PK;

        OpenChannelConfirmation memory confirmation =
            _openChannelConfirmation(REJECTED_OPEN_CHANNEL_ID, participantPrivateKeys, new uint256[](1));

        vm.expectRevert(abi.encodeWithSelector(ErrorAtLeastTwoParticipantsRequired.selector, uint256(1)));
        diamond.open(confirmation);
    }

    // a failing deposit reverts the whole open, naming its index and participant
    function test_open_failingDeposit_revertsTheWholeOpen() public {
        SelectiveDepositConsumerFacet selectiveConsumer = new SelectiveDepositConsumerFacet();
        vm.etch(address(consumerFacet), address(selectiveConsumer).code);
        uint256[] memory participantPrivateKeys = new uint256[](2);
        participantPrivateKeys[0] = SIGNER_PK;
        participantPrivateKeys[1] = SECOND_SIGNER_PK;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500;
        amounts[1] = 0; // the selective consumer rejects it

        OpenChannelConfirmation memory confirmation =
            _openChannelConfirmation(REJECTED_OPEN_CHANNEL_ID, participantPrivateKeys, amounts);

        vm.expectRevert(
            abi.encodeWithSelector(ErrorJoinChannelAtomicFailure.selector, uint256(1), vm.addr(SECOND_SIGNER_PK))
        );
        diamond.open(confirmation);
    }

    function test_open_recordsTheSignedGenesisCommitment() public {
        vm.warp(OPEN_DEADLINE - 7);
        OpenChannelConfirmation memory confirmation = _deadlineOpenConfirmation();
        OpenChannel memory terms = abi.decode(confirmation.encodedOpenChannel, (OpenChannel));
        vm.recordLogs();
        diamond.open(confirmation);
        MessageBlock memory inbound = abi.decode(
            _logData(
                vm.getRecordedLogs(), StateChannelManagerEvents.InboundMessagesProcessed.selector, DEADLINE_CHANNEL_ID
            ),
            (MessageBlock)
        );

        StateSnapshot memory snapshot = diamond.getStateSnapshot(DEADLINE_CHANNEL_ID);
        assertEq(snapshot.snapshotData.stateMachineStateHash, terms.genesisStateHash, "signed hash not recorded");
        assertEq(snapshot.snapshotData.participants, terms.participants, "participants are not the terms'");
        assertEq(snapshot.snapshotData.latestInboundMessageBlockHash, keccak256(abi.encode(inbound)));
        assertEq(snapshot.snapshotData.latestInboundMessageBlockHeight, 1);
        assertEq(snapshot.snapshotData.totalDeposits.amount, 500);
        assertEq(snapshot.timestamp, OPEN_DEADLINE - 7, "not the inclusion time");
        assertEq(snapshot.blockHeight, 0);
        assertEq(snapshot.forkId, keccak256(abi.encode(snapshot.snapshotData)));
    }

    // the etched hook reverts, so the open succeeds only if the manager never calls it
    function test_open_neverCallsTheGenesisHook() public {
        SelectiveDepositConsumerFacet selectiveConsumer = new SelectiveDepositConsumerFacet();
        vm.etch(address(consumerFacet), address(selectiveConsumer).code);
        vm.warp(OPEN_DEADLINE);
        OpenChannelConfirmation memory confirmation = _deadlineOpenConfirmation();

        diamond.open(confirmation);

        _assertOpenedWithDeposits();
        assertEq(
            diamond.getStateSnapshot(DEADLINE_CHANNEL_ID).snapshotData.stateMachineStateHash,
            abi.decode(confirmation.encodedOpenChannel, (OpenChannel)).genesisStateHash
        );
    }

    function test_open_emitsTheSnapshotAndTheOpeningData() public {
        vm.warp(OPEN_DEADLINE);
        OpenChannel memory terms = abi.decode(_deadlineOpenConfirmation().encodedOpenChannel, (OpenChannel));
        terms.data = hex"beef";
        bytes memory encodedTerms = abi.encode(terms);
        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = encodedTerms;
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = _sign(SIGNER_PK, encodedTerms);
        confirmation.signatures[1] = _sign(SECOND_SIGNER_PK, encodedTerms);
        vm.recordLogs();

        diamond.open(confirmation);

        (StateSnapshot memory emitted, bytes memory openingData) = abi.decode(
            _logData(vm.getRecordedLogs(), StateChannelManagerEvents.ChannelOpened.selector, DEADLINE_CHANNEL_ID),
            (StateSnapshot, bytes)
        );
        assertEq(openingData, hex"beef", "event does not carry the opening data");
        assertEq(
            keccak256(abi.encode(emitted)),
            keccak256(abi.encode(diamond.getStateSnapshot(DEADLINE_CHANNEL_ID))),
            "event snapshot differs from storage"
        );
    }

    // open() must reject a union larger than the enforced maximum. The client
    // queue derives its per-entry signature retention from this bound, so an
    // unbounded union would mean a valid block could carry more confirmations
    // than a peer is required to retain.
    function test_open_participantsAboveMaximum_reverts() public {
        // Read the bound from the deployed channel rather than a compile-time
        // constant: the maximum is configuration now, and the check has to
        // follow whatever this channel was deployed with.
        uint256 maximum = diamond.getMaxChannelParticipants();
        uint256 count = maximum + 1;
        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = _encodeOpenChannelWith(count);
        confirmation.signatures = new bytes[](count);

        vm.expectRevert(abi.encodeWithSelector(ErrorTooManyParticipants.selector, count, maximum));
        diamond.open(confirmation);
    }

    // The boundary itself is accepted: the check rejects above the maximum, not
    // at it, so a channel may use every seat the bound allows.
    function test_open_participantsAtMaximum_passesTheBoundCheck() public {
        uint256 maximum = diamond.getMaxChannelParticipants();
        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = _encodeOpenChannelWith(maximum);
        confirmation.signatures = new bytes[](maximum);

        // Reverts later on signature verification, never on the bound.
        try diamond.open(confirmation) {
            revert("expected open to revert on signatures");
        } catch (bytes memory reason) {
            require(_selectorOf(reason) != ErrorTooManyParticipants.selector, "bound rejected the maximum itself");
        }
    }

    function test_open_beforeDeadline_opensChannel() public {
        vm.warp(OPEN_DEADLINE - 1);

        diamond.open(_deadlineOpenConfirmation());

        _assertOpenedWithDeposits();
    }

    // Same inclusive boundary as joinChannel.
    function test_open_atDeadline_opensChannel() public {
        vm.warp(OPEN_DEADLINE);

        diamond.open(_deadlineOpenConfirmation());

        _assertOpenedWithDeposits();
    }

    // Unanimous signatures do not keep expired terms alive. The revert rolls back
    // every write, so the exact revert payload is the whole oracle.
    function test_open_afterDeadline_revertsWithOpenChannelExpired() public {
        vm.warp(OPEN_DEADLINE + 1);
        OpenChannelConfirmation memory confirmation = _deadlineOpenConfirmation();

        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionOpenChannelExpired.selector, OPEN_DEADLINE, OPEN_DEADLINE + 1)
        );
        diamond.open(confirmation);
    }

    // The already-open check runs before the deadline check, so a duplicate open of
    // an open channel reports already-open even once its terms have expired.
    function test_open_alreadyOpenAfterDeadline_revertsWithChannelAlreadyOpen() public {
        vm.warp(OPEN_DEADLINE);
        OpenChannelConfirmation memory confirmation = _deadlineOpenConfirmation();
        diamond.open(confirmation);
        vm.warp(OPEN_DEADLINE + 1);

        vm.expectRevert(abi.encodeWithSelector(RaceConditionChannelAlreadyOpen.selector, DEADLINE_CHANNEL_ID));
        diamond.open(confirmation);
    }

    // the chain keeps a record of the genesis inbound block under the hash of the full emitted block
    function test_open_storesTheGenesisRecordUnderTheFullBlockHash() public {
        vm.recordLogs();
        diamond.open(_deadlineOpenConfirmation());
        MessageBlock memory genesis = abi.decode(
            _logData(
                vm.getRecordedLogs(), StateChannelManagerEvents.InboundMessagesProcessed.selector, DEADLINE_CHANNEL_ID
            ),
            (MessageBlock)
        );
        bytes32 genesisHash = keccak256(abi.encode(genesis));

        assertTrue(diamond.hasInboundMessageBlock(DEADLINE_CHANNEL_ID, genesisHash), "genesis record not stored");
        SnapshotData memory snapshotData = diamond.getStateSnapshot(DEADLINE_CHANNEL_ID).snapshotData;
        assertEq(snapshotData.latestInboundMessageBlockHash, genesisHash, "snapshot head is not the genesis block");
        assertEq(snapshotData.latestInboundMessageBlockHeight, 1, "genesis height");
        assertEq(snapshotData.totalDeposits.amount, 500, "genesis deposit total");
        // the genesis block is the snapshot head -> its joiners are consumed
        assertEq(diamond.getPendingParticipants(DEADLINE_CHANNEL_ID).length, 0, "openers left pending");
        assertFalse(
            diamond.isUncommittedInboundMessageBlock(DEADLINE_CHANNEL_ID, genesis), "genesis block reads uncommitted"
        );
    }

    function _deadlineOpenConfirmation() internal view returns (OpenChannelConfirmation memory) {
        uint256[] memory participantPrivateKeys = new uint256[](2);
        participantPrivateKeys[0] = SIGNER_PK;
        participantPrivateKeys[1] = SECOND_SIGNER_PK;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300;
        amounts[1] = 200;
        return _openChannelConfirmationWithDeadline(DEADLINE_CHANNEL_ID, participantPrivateKeys, amounts, OPEN_DEADLINE);
    }

    function _assertOpenedWithDeposits() internal view {
        (bool isOpen,) = diamond.isChannelOpen(DEADLINE_CHANNEL_ID);
        assertTrue(isOpen, "valid terms did not open the channel");
        // 300 + 200 from the signed balances
        assertEq(diamond.getChannelBalance(DEADLINE_CHANNEL_ID).totalDeposits.amount, 500, "deposits not taken");
    }

    function _selectorOf(bytes memory reason) internal pure returns (bytes4) {
        if (reason.length < 4) return bytes4(0);
        return bytes4(reason[0]) | (bytes4(reason[1]) >> 8) | (bytes4(reason[2]) >> 16) | (bytes4(reason[3]) >> 24);
    }

    function _encodeOpenChannelWith(uint256 count) internal view returns (bytes memory) {
        OpenChannel memory oc;
        oc.channelId = CHANNEL_ID;
        oc.participants = new address[](count);
        oc.balances = new Balance[](count);
        for (uint256 i = 0; i < count; i++) {
            oc.participants[i] = address(uint160(i + 1));
            oc.balances[i] = Balance({amount: 500, data: ""});
        }
        oc.deadlineTimestamp = block.timestamp + 120;
        oc.genesisStateHash = keccak256("genesis");
        oc.data = "";
        return abi.encode(oc);
    }

    function _encodeOpenChannel(address a, address b) internal view returns (bytes memory) {
        OpenChannel memory oc;
        oc.channelId = CHANNEL_ID;
        oc.participants = new address[](2);
        oc.participants[0] = a;
        oc.participants[1] = b;
        oc.balances = new Balance[](2);
        oc.balances[0] = Balance({amount: 500, data: ""});
        oc.balances[1] = Balance({amount: 500, data: ""});
        oc.deadlineTimestamp = block.timestamp + 120;
        oc.genesisStateHash = keccak256("genesis");
        oc.data = "";
        return abi.encode(oc);
    }
}
