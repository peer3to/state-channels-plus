pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {
    ErrorDuplicateParticipant,
    ErrorTooManyParticipants,
    MAX_CHANNEL_PARTICIPANTS
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract StateChannelManagerProxyOpenTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant SIGNER_PK = 0xA11CE;
    bytes32 internal constant CHANNEL_ID = keccak256("duplicate-participants");

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

        vm.expectRevert(ErrorDuplicateParticipant.selector);
        diamond.open(confirmation);
    }

    // open() must reject a union larger than the enforced maximum. The client
    // queue derives its per-entry signature retention from this bound, so an
    // unbounded union would mean a valid block could carry more confirmations
    // than a peer is required to retain.
    function test_open_participantsAboveMaximum_reverts() public {
        uint256 count = MAX_CHANNEL_PARTICIPANTS + 1;
        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = _encodeOpenChannelWith(count);
        confirmation.signatures = new bytes[](count);

        vm.expectRevert(abi.encodeWithSelector(ErrorTooManyParticipants.selector, count, MAX_CHANNEL_PARTICIPANTS));
        diamond.open(confirmation);
    }

    // The boundary itself is accepted: the check rejects above the maximum, not
    // at it, so a channel may use every seat the bound allows.
    function test_open_participantsAtMaximum_passesTheBoundCheck() public {
        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = _encodeOpenChannelWith(MAX_CHANNEL_PARTICIPANTS);
        confirmation.signatures = new bytes[](MAX_CHANNEL_PARTICIPANTS);

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
