pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {LocalDiamond} from "../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// The local diamond's inbound mirror: an inbound block is applied
/// idempotently whatever its source, and the inbound head with its deposit
/// total only moves forward.
contract LocalDiamondInboundMirrorTest is DiamondHarness {
    bytes32 internal constant CHANNEL_ID = keccak256("local-diamond-inbound-mirror");

    LocalDiamond internal localDiamond;
    StateChannelManagerInterface internal mirror;

    function setUp() public {
        deployDiamond();
        localDiamond = LocalDiamond(
            payable(vm.deployCode(
                    "LocalDiamond.sol:LocalDiamond",
                    abi.encode(
                        address(stateMachine),
                        vm.deployCode("DisputeManagerFacet.sol:DisputeManagerFacet"),
                        vm.deployCode("DisputeVerificationFacet.sol:DisputeVerificationFacet"),
                        address(fraudProofFacet),
                        vm.deployCode("DisputeFraudProofFacet.sol:DisputeFraudProofFacet"),
                        vm.deployCode("StateSnapshotFacet.sol:StateSnapshotFacet"),
                        vm.deployCode("JoinChannelFacet.sol:JoinChannelFacet"),
                        vm.deployCode("StateProofFacet.sol:StateProofFacet"),
                        address(utilityFacet),
                        P2P_TIME,
                        0,
                        0,
                        0,
                        0,
                        MAX_CHANNEL_PARTICIPANTS
                    )
                ))
        );
        mirror = StateChannelManagerInterface(address(localDiamond));
    }

    function test_onInboundMessagesProcessed_storedBlockAgain_isNoOp() public {
        MessageBlock memory first = _inboundBlock(bytes32(0), 1, 100);
        MessageBlock memory second = _inboundBlock(keccak256(abi.encode(first)), 2, 250);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, first);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, second);

        // the older block applied again: no revert, the head stays
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, first);
        // the head block applied again: no revert, the head stays
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, second);

        _assertHead(second, 250);
        assertTrue(mirror.hasInboundMessageBlock(CHANNEL_ID, keccak256(abi.encode(first))));
    }

    function test_onInboundMessagesProcessed_olderBlockAfterNewer_storesItWithoutMovingTheHeadBack() public {
        MessageBlock memory first = _inboundBlock(bytes32(0), 1, 100);
        MessageBlock memory second = _inboundBlock(keccak256(abi.encode(first)), 2, 250);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, second);

        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, first);

        _assertHead(second, 250);
        assertTrue(mirror.hasInboundMessageBlock(CHANNEL_ID, keccak256(abi.encode(first))));
        assertTrue(mirror.hasInboundMessageBlock(CHANNEL_ID, keccak256(abi.encode(second))));
    }

    function _assertHead(MessageBlock memory head, uint256 totalDeposits) internal view {
        ChannelBalance memory balance = mirror.getChannelBalance(CHANNEL_ID);
        assertEq(balance.latestInboundMessageBlockHash, keccak256(abi.encode(head)));
        assertEq(balance.latestInboundMessageBlockHeight, head.blockHeight);
        assertEq(balance.totalDeposits.amount, totalDeposits);
    }

    function _inboundBlock(bytes32 previousBlockHash, uint256 blockHeight, uint256 totalDeposits)
        internal
        view
        returns (MessageBlock memory messageBlock)
    {
        messageBlock.previousBlockHash = previousBlockHash;
        messageBlock.blockHeight = blockHeight;
        messageBlock.messages = new Message[](1);
        messageBlock.messages[0].participant = address(0xA1);
        messageBlock.messages[0].balance.amount = totalDeposits;
        messageBlock.totalBalance.amount = totalDeposits;
        messageBlock.timestamp = block.timestamp + blockHeight;
    }
}
