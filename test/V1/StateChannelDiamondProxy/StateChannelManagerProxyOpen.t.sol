pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {ErrorDuplicateParticipant} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
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
