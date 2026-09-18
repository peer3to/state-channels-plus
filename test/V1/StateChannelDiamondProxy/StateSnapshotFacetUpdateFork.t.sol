pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {
    ErrorNotGenesisSnapshot,
    ErrorSnapshotGenesisTimestampMismatch,
    ErrorStateSnapshotNotValid,
    RaceConditionGenesisTimestampNotAvailable
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";

// test naming: test_<targetFunction>_<property>
contract StateSnapshotFacetUpdateForkTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    bytes32 internal constant CHANNEL_ID = keccak256("update-fork-channel");

    function setUp() public {
        diamond = deployDiamond();
        _openChannel(CHANNEL_ID, _privateKeys());
    }

    // the target snapshot must commit to its own snapshotData at height 0
    function test_updateStateSnapshotFork_snapshotNotGenesis_revertsCarryingBothForkIdsAndHeight() public {
        StateSnapshot memory target = _genesisShapedSnapshot();
        // the fixture built forkId as the hash of the snapshot data, so capture
        // it before overwriting: the error's expected side must stay that hash
        bytes32 snapshotDataHash = target.forkId;
        target.blockHeight = 1;
        target.forkId = keccak256("a fork the snapshot data does not hash to");

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorNotGenesisSnapshot.selector, snapshotDataHash, target.forkId, target.blockHeight
            )
        );
        diamond.updateStateSnapshotFork(CHANNEL_ID, target, new MessageBlock[](0));
    }

    // no dispute window on the origin fork -> the chain cannot date the genesis
    function test_updateStateSnapshotFork_noDisputeWindowOnOriginFork_revertsCarryingBothForkIds() public {
        StateSnapshot memory target = _genesisShapedSnapshot();

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionGenesisTimestampNotAvailable.selector,
                CHANNEL_ID,
                target.snapshotData.originForkId,
                target.forkId
            )
        );
        diamond.updateStateSnapshotFork(CHANNEL_ID, target, new MessageBlock[](0));
    }

    // the chain dates the genesis at the origin window's kill-period end, so a
    // target snapshot claiming any other timestamp is rejected
    function test_updateStateSnapshotFork_genesisTimestampMismatch_revertsCarryingBothTimestamps() public {
        uint256 genesisTimestamp = _expireDisputeWindowOnCurrentFork();

        StateSnapshot memory target = _genesisShapedSnapshot();
        target.timestamp = genesisTimestamp + 1;
        target.forkId = keccak256(abi.encode(target.snapshotData));

        vm.expectRevert(
            abi.encodeWithSelector(ErrorSnapshotGenesisTimestampMismatch.selector, genesisTimestamp, target.timestamp)
        );
        diamond.updateStateSnapshotFork(CHANNEL_ID, target, new MessageBlock[](0));
    }

    // a genesis-shaped, correctly dated target is still rejected when no chain
    // of expired reduced results leads from the current fork to it: the origin
    // window here has evidence but was never reduced, so the walk never starts
    function test_updateStateSnapshotFork_targetForkUnreachableByReductions_revertsCarryingCurrentAndTargetForkIds()
        public
    {
        uint256 genesisTimestamp = _expireDisputeWindowOnCurrentFork();
        bytes32 currentForkId = diamond.getStateSnapshot(CHANNEL_ID).forkId;

        StateSnapshot memory target = _genesisShapedSnapshot();
        target.timestamp = genesisTimestamp;
        // the two reported forks must be distinguishable, or a swapped payload
        // would still satisfy the oracle below
        assertTrue(currentForkId != target.forkId);

        vm.expectRevert(abi.encodeWithSelector(ErrorStateSnapshotNotValid.selector, currentForkId, target.forkId));
        diamond.updateStateSnapshotFork(CHANNEL_ID, target, new MessageBlock[](0));
    }

    /// Opens a dispute window on the channel's current fork and warps past its
    /// kill period, so `_getGenesisTimestamp` can date a child fork. Returns
    /// the genesis timestamp the chain will report.
    function _expireDisputeWindowOnCurrentFork() internal returns (uint256 genesisTimestamp) {
        StateSnapshot memory current = diamond.getStateSnapshot(CHANNEL_ID);
        address[] memory participants = _participants();

        Dispute memory dispute;
        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = current.forkId;
        dispute.input.disputer = participants[0];

        DisputeConfirmation memory confirmation;
        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        confirmation.signedDispute.signature = _sign(ALICE_PK, confirmation.signedDispute.encodedDispute);
        confirmation.signatures = new bytes[](0);

        vm.prank(participants[0]);
        diamond.uploadDispute(confirmation);

        genesisTimestamp = block.timestamp + diamond.getEvidenceTime();
        vm.warp(genesisTimestamp);
    }

    /// A snapshot that passes `isGenesisSnapshotWithoutTimeCheck` and whose
    /// origin fork is the channel's current fork.
    function _genesisShapedSnapshot() internal view returns (StateSnapshot memory target) {
        StateSnapshot memory current = diamond.getStateSnapshot(CHANNEL_ID);
        target.snapshotData = current.snapshotData;
        target.snapshotData.originForkId = current.forkId;
        target.blockHeight = 0;
        target.timestamp = current.timestamp;
        target.forkId = keccak256(abi.encode(target.snapshotData));
    }

    function _privateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }

    function _participants() internal pure returns (address[] memory participants) {
        participants = new address[](2);
        participants[0] = vm.addr(ALICE_PK);
        participants[1] = vm.addr(BOB_PK);
    }
}
