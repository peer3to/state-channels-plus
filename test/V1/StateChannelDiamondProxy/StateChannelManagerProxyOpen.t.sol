pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import {ErrorDuplicateParticipant} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
//
// `OpenChannel.balances` is documented as a parallel array to `participants`
// (DataTypes.sol) but deliberately not enforced on-chain. These tests pin the two
// trust-model properties that make the check unnecessary, so the decision stays
// falsifiable instead of resting on a comment:
//
//   1. one honest participant is enough - a malformed term never reaches the
//      threshold, because the honest peer's signature cannot be produced without it
//   2. a fully colluding set only affects itself - per-participant data is consumed
//      only for listed participants, so a surplus entry creates no deposit credit
contract StateChannelManagerProxyOpenTest is DiamondHarness {
    StateChannelManagerProxy internal diamond;

    uint256 internal constant PK_A = 0xA11CE;
    uint256 internal constant PK_B = 0xB0B;
    uint256 internal constant BALANCE = 500;

    function setUp() public {
        diamond = deployDiamond();
    }

    // open() must reject duplicate participants
    function test_open_duplicateParticipants_reverts() public {
        address signer = vm.addr(PK_A);
        address[] memory participants = new address[](2);
        participants[0] = signer;
        participants[1] = signer;
        bytes memory encoded = _encodeOpenChannel(keccak256("duplicate-participants"), participants, 2);

        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = encoded;
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = _sign(PK_A, encoded);
        confirmation.signatures[1] = _sign(PK_A, encoded);

        vm.expectRevert(ErrorDuplicateParticipant.selector);
        diamond.open(confirmation);
    }

    // property 1: an honest participant who does not sign a malformed term keeps it
    // below the threshold - no on-chain structural check is needed to stop it
    function test_open_malformedTerms_abstainingParticipantBlocksThreshold() public {
        bytes memory encoded = _encodeOpenChannel(keccak256("abstain"), _participants(), 3);

        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = encoded;
        confirmation.signatures = new bytes[](1);
        confirmation.signatures[0] = _sign(PK_A, encoded);

        vm.expectRevert(bytes("Cryptography: Not enough signatures provided"));
        diamond.open(confirmation);

        (bool isOpen,) = diamond.isChannelOpen(keccak256("abstain"));
        assertFalse(isOpen, "no channel may exist after a sub-threshold open");
    }

    // ...and the colluding participant cannot stand in for the honest one: filling
    // both slots with its own signature still fails the threshold
    function test_open_malformedTerms_colluderCannotForgeTheAbstainer() public {
        bytes memory encoded = _encodeOpenChannel(keccak256("forge"), _participants(), 3);

        OpenChannelConfirmation memory confirmation;
        confirmation.encodedOpenChannel = encoded;
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = _sign(PK_A, encoded);
        confirmation.signatures[1] = _sign(PK_A, encoded);

        vm.expectRevert(bytes("Cryptography: Not enough valid signatures"));
        diamond.open(confirmation);

        (bool isOpen,) = diamond.isChannelOpen(keccak256("forge"));
        assertFalse(isOpen, "no channel may exist after a forged threshold");
    }

    // property 2: everyone signs a surplus balance - the channel opens, but the
    // surplus buys nothing. Deposits are composed per listed participant, so the
    // extra entry is never escrowed and never becomes withdrawable credit.
    function test_open_collusiveSurplusBalances_createNoDepositCredit() public {
        bytes32 channelId = keccak256("surplus");
        diamond.open(_signedConfirmation(channelId, 3));

        (bool isOpen, StateSnapshot memory snapshot) = diamond.isChannelOpen(channelId);
        assertTrue(isOpen, "a unanimously signed open still opens");
        assertEq(snapshot.snapshotData.participants.length, 2, "only listed participants are admitted");
        assertEq(
            snapshot.snapshotData.totalDeposits.amount,
            2 * BALANCE,
            "the surplus balance must not be credited as a deposit"
        );
        assertEq(snapshot.snapshotData.totalWithdrawals.amount, 0, "nothing is withdrawn at genesis");
    }

    // control: the well-formed open records exactly the same totals, so the surplus
    // above changed nothing rather than merely being tolerated
    function test_open_wellFormedTerms_recordSameTotalsAsSurplusTerms() public {
        bytes32 channelId = keccak256("well-formed");
        diamond.open(_signedConfirmation(channelId, 2));

        (bool isOpen, StateSnapshot memory snapshot) = diamond.isChannelOpen(channelId);
        assertTrue(isOpen);
        assertEq(snapshot.snapshotData.participants.length, 2);
        assertEq(snapshot.snapshotData.totalDeposits.amount, 2 * BALANCE);
    }

    // the other malformed direction cannot be used to strand escrow: indexing past
    // the balance sequence reverts the whole call, so no channel and no deposit persist
    function test_open_collusiveShortBalances_leaveNoState() public {
        bytes32 channelId = keccak256("short");

        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x32));
        diamond.open(_signedConfirmation(channelId, 1));

        (bool isOpen,) = diamond.isChannelOpen(channelId);
        assertFalse(isOpen, "a reverted open must leave no channel behind");
    }

    function _participants() internal pure returns (address[] memory participants) {
        participants = new address[](2);
        participants[0] = vm.addr(PK_A);
        participants[1] = vm.addr(PK_B);
    }

    // both listed participants sign - the fully colluding case
    function _signedConfirmation(bytes32 channelId, uint256 balanceCount)
        internal
        view
        returns (OpenChannelConfirmation memory confirmation)
    {
        bytes memory encoded = _encodeOpenChannel(channelId, _participants(), balanceCount);
        confirmation.encodedOpenChannel = encoded;
        confirmation.signatures = new bytes[](2);
        confirmation.signatures[0] = _sign(PK_A, encoded);
        confirmation.signatures[1] = _sign(PK_B, encoded);
    }

    function _encodeOpenChannel(bytes32 channelId, address[] memory participants, uint256 balanceCount)
        internal
        view
        returns (bytes memory)
    {
        OpenChannel memory oc;
        oc.channelId = channelId;
        oc.participants = participants;
        oc.balances = new Balance[](balanceCount);
        for (uint256 i = 0; i < balanceCount; i++) {
            oc.balances[i] = Balance({amount: BALANCE, data: ""});
        }
        oc.deadlineTimestamp = block.timestamp + 120;
        oc.isAtomic = true;
        oc.data = "";
        return abi.encode(oc);
    }
}
