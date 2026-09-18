pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {
    ErrorAtLeastTwoParticipantsRequired,
    ErrorDuplicateParticipant,
    ErrorTooManyParticipants
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {SelectiveDepositConsumerFacet} from "../harness/SelectiveDepositConsumerFacet.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract StateChannelManagerProxyOpenTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant SIGNER_PK = 0xA11CE;
    uint256 internal constant SECOND_SIGNER_PK = 0xB0B;
    uint256 internal constant THIRD_SIGNER_PK = 0xCA401;
    bytes32 internal constant CHANNEL_ID = keccak256("duplicate-participants");
    bytes32 internal constant PARTIAL_CHANNEL_ID = keccak256("partial-open");

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

    /// The count in the payload must be the number of SUCCESSFUL joins, not the
    /// length of the submitted participant list. Three participants are
    /// submitted and the consumer rejects two of the three deposits, so the two
    /// numbers are 3 and 1 and cannot be confused.
    function test_open_fewerThanTwoSuccessfulJoins_revertsWithSuccessfulJoinCount() public {
        // the selective consumer rejects a zero-amount deposit, so the failing
        // joins genuinely fail inside the proxy's real deposit loop
        SelectiveDepositConsumerFacet selectiveConsumer = new SelectiveDepositConsumerFacet();
        vm.etch(address(consumerFacet), address(selectiveConsumer).code);

        uint256[] memory participantPrivateKeys = new uint256[](3);
        participantPrivateKeys[0] = SIGNER_PK;
        participantPrivateKeys[1] = SECOND_SIGNER_PK;
        participantPrivateKeys[2] = THIRD_SIGNER_PK;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 500; // the only deposit the consumer accepts
        amounts[1] = 0;
        amounts[2] = 0;

        // non-atomic: an atomic batch reverts on the first failing deposit and
        // never reaches the successful-join count guard
        OpenChannelConfirmation memory confirmation =
            _openChannelConfirmation(PARTIAL_CHANNEL_ID, participantPrivateKeys, amounts, false);

        // The payload is the oracle: 1 is the number of deposits the consumer
        // accepted, against 3 submitted addresses. A post-revert storage read
        // would add nothing - the revert rolls every effect back, so it would
        // hold for an implementation that never ran the deposit loop at all.
        vm.expectRevert(abi.encodeWithSelector(ErrorAtLeastTwoParticipantsRequired.selector, uint256(1)));
        diamond.open(confirmation);
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
        oc.isAtomic = true;
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
        oc.isAtomic = true;
        oc.data = "";
        return abi.encode(oc);
    }
}
