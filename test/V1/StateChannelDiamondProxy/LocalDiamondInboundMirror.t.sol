pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {LocalDiamond} from "../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol";
import {StateChannelManagerEvents} from "../../../contracts/V1/StateChannelManagerEvents.sol";
import {Vm} from "forge-std/Vm.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// The local diamond's inbound mirror: an inbound block is applied
/// idempotently whatever its source, and the inbound head with its deposit
/// total only moves forward.
contract LocalDiamondInboundMirrorTest is DiamondHarness {
    bytes32 internal constant CHANNEL_ID = keccak256("local-diamond-inbound-mirror");

    bytes32 internal constant GENESIS_CHANNEL_ID = keccak256("local-diamond-genesis-inbound");
    uint256 internal constant JOINER_PK = 0xCAFE;

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
                        address(0),
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

    function test_onChannelStorageCleared_prunesFromTheFirstPrunedBlockAndKeepsTheBlocksAbove() public {
        MessageBlock memory first = _inboundBlock(bytes32(0), 1, 100);
        MessageBlock memory second = _inboundBlock(keccak256(abi.encode(first)), 2, 250);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, first);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, second);

        // the chain kept the snapshot head `second` and pruned from `first`
        localDiamond.onChannelStorageCleared(CHANNEL_ID, keccak256(abi.encode(first)), 1, 0);

        assertFalse(mirror.hasInboundMessageBlock(CHANNEL_ID, keccak256(abi.encode(first))));
        assertTrue(mirror.hasInboundMessageBlock(CHANNEL_ID, keccak256(abi.encode(second))));
        _assertHead(second, 250);
    }

    function test_onChannelStorageCleared_alreadyPrunedBlock_keepsTheHead() public {
        MessageBlock memory first = _inboundBlock(bytes32(0), 1, 100);
        MessageBlock memory second = _inboundBlock(keccak256(abi.encode(first)), 2, 250);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, first);
        localDiamond.onInboundMessagesProcessed(CHANNEL_ID, second);
        localDiamond.onChannelStorageCleared(CHANNEL_ID, keccak256(abi.encode(first)), 1, 0);

        // a later advance with the same head names the block the first clearing already deleted
        localDiamond.onChannelStorageCleared(CHANNEL_ID, keccak256(abi.encode(first)), 2, 0);

        assertTrue(mirror.hasInboundMessageBlock(CHANNEL_ID, keccak256(abi.encode(second))));
        _assertHead(second, 250);
    }

    function test_onChannelStorageCleared_clearsTheMirroredOnChainSlashes() public {
        localDiamond.onOnChainSlashAdded(CHANNEL_ID, vm.addr(JOINER_PK), block.timestamp);
        assertEq(mirror.getOnChainSlashedParticipants(CHANNEL_ID).length, 1, "slash not mirrored");

        localDiamond.onChannelStorageCleared(CHANNEL_ID, bytes32(0), 1, 0);

        assertEq(mirror.getOnChainSlashedParticipants(CHANNEL_ID).length, 0, "slash kept after clearing");
    }

    function test_openReplay_eitherOrder_storesTheGenesisInboundBlockOnlyThroughTheInboundEvent() public {
        (MessageBlock memory genesisBlock, StateSnapshot memory genesisSnapshot) = _openAndRecordGenesis();
        bytes32 genesisHead = keccak256(abi.encode(genesisBlock));
        assertEq(genesisSnapshot.snapshotData.latestInboundMessageBlockHash, genesisHead);
        uint256 beforeReplay = vm.snapshotState();

        // the open transaction's log order: InboundMessagesProcessed, then ChannelOpened
        localDiamond.onInboundMessagesProcessed(GENESIS_CHANNEL_ID, genesisBlock);
        localDiamond.onChannelOpened(GENESIS_CHANNEL_ID, genesisSnapshot, block.number, 1);
        _assertGenesisMirrored(genesisBlock, genesisSnapshot);

        vm.revertToState(beforeReplay);
        // ChannelOpened alone stores no inbound block
        localDiamond.onChannelOpened(GENESIS_CHANNEL_ID, genesisSnapshot, block.number, 1);
        assertFalse(mirror.hasInboundMessageBlock(GENESIS_CHANNEL_ID, genesisHead));
        // the inbound event after it stores the block and leaves the head at the snapshot's
        localDiamond.onInboundMessagesProcessed(GENESIS_CHANNEL_ID, genesisBlock);
        _assertGenesisMirrored(genesisBlock, genesisSnapshot);
    }

    function test_onInboundMessagesProcessed_joinAfterGenesis_mirrorPendingMatchesChain() public {
        (MessageBlock memory genesisBlock, StateSnapshot memory genesisSnapshot) = _openAndRecordGenesis();
        localDiamond.onInboundMessagesProcessed(GENESIS_CHANNEL_ID, genesisBlock);
        localDiamond.onChannelOpened(GENESIS_CHANNEL_ID, genesisSnapshot, block.number, 1);

        address joiner = vm.addr(JOINER_PK);
        JoinChannel memory join = JoinChannel({
            channelId: GENESIS_CHANNEL_ID,
            participant: joiner,
            deadlineTimestamp: block.timestamp + 120,
            balance: Balance({amount: 100, data: ""})
        });
        vm.recordLogs();
        vm.prank(joiner);
        deployedDiamond.joinChannel(
            _joinConfirmation(join, JOINER_PK, _twoPartyPrivateKeys()),
            keccak256(abi.encode(genesisSnapshot)),
            genesisSnapshot.forkId
        );
        MessageBlock memory joinBlock = abi.decode(
            _logData(
                vm.getRecordedLogs(), StateChannelManagerEvents.InboundMessagesProcessed.selector, GENESIS_CHANNEL_ID
            ),
            (MessageBlock)
        );
        localDiamond.onInboundMessagesProcessed(GENESIS_CHANNEL_ID, joinBlock);

        address[] memory chainPending = deployedDiamond.getPendingParticipants(GENESIS_CHANNEL_ID);
        address[] memory mirrorPending = mirror.getPendingParticipants(GENESIS_CHANNEL_ID);
        assertEq(chainPending.length, 1, "chain pending count");
        assertEq(chainPending[0], joiner, "chain pending joiner");
        assertEq(mirrorPending.length, 1, "mirror pending count");
        assertEq(mirrorPending[0], joiner, "mirror pending joiner");
    }

    function _assertHead(MessageBlock memory head, uint256 totalDeposits) internal view {
        ChannelBalance memory balance = mirror.getChannelBalance(CHANNEL_ID);
        assertEq(balance.latestInboundMessageBlockHash, keccak256(abi.encode(head)));
        assertEq(balance.latestInboundMessageBlockHeight, head.blockHeight);
        assertEq(balance.totalDeposits.amount, totalDeposits);
    }

    function _assertGenesisMirrored(MessageBlock memory genesisBlock, StateSnapshot memory genesisSnapshot)
        internal
        view
    {
        bytes32 genesisHead = keccak256(abi.encode(genesisBlock));
        assertTrue(mirror.hasInboundMessageBlock(GENESIS_CHANNEL_ID, genesisHead));
        ChannelBalance memory balance = mirror.getChannelBalance(GENESIS_CHANNEL_ID);
        assertEq(balance.latestInboundMessageBlockHash, genesisHead);
        assertEq(balance.latestInboundMessageBlockHeight, genesisSnapshot.snapshotData.latestInboundMessageBlockHeight);
        assertEq(balance.totalDeposits.amount, genesisSnapshot.snapshotData.totalDeposits.amount);
        // 300 + 200 from the signed balances
        assertEq(balance.totalDeposits.amount, 500);
    }

    /// Opens a channel on the harness diamond and returns the genesis inbound
    /// block and snapshot its logs carry.
    function _openAndRecordGenesis()
        internal
        returns (MessageBlock memory genesisBlock, StateSnapshot memory genesisSnapshot)
    {
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 300;
        amounts[1] = 200;
        vm.recordLogs();
        deployedDiamond.open(_openChannelConfirmation(GENESIS_CHANNEL_ID, _twoPartyPrivateKeys(), amounts));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        genesisBlock = abi.decode(
            _logData(logs, StateChannelManagerEvents.InboundMessagesProcessed.selector, GENESIS_CHANNEL_ID),
            (MessageBlock)
        );
        (genesisSnapshot,) = abi.decode(
            _logData(logs, StateChannelManagerEvents.ChannelOpened.selector, GENESIS_CHANNEL_ID), (StateSnapshot, bytes)
        );
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
