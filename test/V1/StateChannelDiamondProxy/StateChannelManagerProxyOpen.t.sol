pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {
    ErrorAtLeastTwoParticipantsRequired,
    ErrorDuplicateParticipant
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {SelectiveDepositConsumerFacet} from "./StateChannelManagerProxyDeposit.t.sol";
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

        OpenChannelConfirmation memory confirmation = _partialOpenConfirmation(participantPrivateKeys, amounts);

        // The payload is the oracle: 1 is the number of deposits the consumer
        // accepted, against 3 submitted addresses. A post-revert storage read
        // would add nothing - the revert rolls every effect back, so it would
        // hold for an implementation that never ran the deposit loop at all.
        vm.expectRevert(abi.encodeWithSelector(ErrorAtLeastTwoParticipantsRequired.selector, uint256(1)));
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

    /// Unanimously signed non-atomic open. Non-atomic is required: an atomic
    /// batch reverts on the first failing deposit and never reaches the
    /// successful-join count guard.
    function _partialOpenConfirmation(uint256[] memory participantPrivateKeys, uint256[] memory amounts)
        internal
        view
        returns (OpenChannelConfirmation memory confirmation)
    {
        OpenChannel memory oc;
        oc.channelId = PARTIAL_CHANNEL_ID;
        oc.participants = new address[](participantPrivateKeys.length);
        oc.balances = new Balance[](participantPrivateKeys.length);
        for (uint256 i = 0; i < participantPrivateKeys.length; i++) {
            oc.participants[i] = vm.addr(participantPrivateKeys[i]);
            oc.balances[i] = Balance({amount: amounts[i], data: ""});
        }
        oc.deadlineTimestamp = block.timestamp + 120;
        oc.isAtomic = false;
        oc.data = "";

        bytes memory encodedOpenChannel = abi.encode(oc);
        bytes[] memory signatures = new bytes[](participantPrivateKeys.length);
        for (uint256 i = 0; i < participantPrivateKeys.length; i++) {
            signatures[i] = _sign(participantPrivateKeys[i], encodedOpenChannel);
        }
        confirmation = OpenChannelConfirmation({encodedOpenChannel: encodedOpenChannel, signatures: signatures});
    }
}
