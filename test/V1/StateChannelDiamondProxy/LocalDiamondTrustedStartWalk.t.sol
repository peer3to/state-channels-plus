pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {LocalDiamond} from "../../../contracts/V1/StateChannelDiamondProxy/LocalDiamond.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The local diamond's walk from a locally trusted final snapshot (synchronization): it runs the one state-proof walk,
/// so a hop whose committed snapshot names another height than its block proves nothing there either.
// test naming: test_<plan case>_<scenario>
contract LocalDiamondTrustedStartWalkTest is DiamondHarness {
    bytes32 internal constant CHANNEL_ID = keccak256("local-diamond-trusted-start-walk");
    bytes32 internal constant FORK_ID = keccak256("local-diamond-trusted-start-fork");
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;
    uint256 internal constant TRUSTED_HEIGHT = 50;

    LocalDiamond internal localDiamond;

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
    }

    function test_CN3_trustedStartWalkRejectsAHopSnapshotAtAnotherHeight() public view {
        // block 51 commits, signed by A and B, a snapshot that names height 52
        StateSnapshot memory misHeighted = _snapshotAt(TRUSTED_HEIGHT + 2);

        ProofWalkResult memory result = localDiamond.verifyMilestonesFromTrustedStart(
            _walkInput(_hop(TRUSTED_HEIGHT + 1, misHeighted), misHeighted), _snapshotAt(TRUSTED_HEIGHT)
        );

        assertFalse(result.valid, "the hop proves no state at another height");
        assertFalse(result.snapshotMismatch, "the block commits that snapshot: an invalid proof, not forged evidence");
    }

    function test_CN3_trustedStartWalkFinalizesAHopSnapshotAtItsBlocksHeight() public view {
        StateSnapshot memory hop = _snapshotAt(TRUSTED_HEIGHT + 1);

        ProofWalkResult memory result = localDiamond.verifyMilestonesFromTrustedStart(
            _walkInput(_hop(TRUSTED_HEIGHT + 1, hop), hop), _snapshotAt(TRUSTED_HEIGHT)
        );

        assertTrue(result.valid, "the honest hop walks from the trusted start");
        assertEq(keccak256(abi.encode(result.finalizedSnapshot)), keccak256(abi.encode(hop)), "the hop is final");
    }

    /// the fork's snapshot of A and B at `height`
    function _snapshotAt(uint256 height) internal pure returns (StateSnapshot memory snapshot) {
        snapshot.snapshotData.participants = new address[](2);
        snapshot.snapshotData.participants[0] = vm.addr(ALICE_KEY);
        snapshot.snapshotData.participants[1] = vm.addr(BOB_KEY);
        snapshot.snapshotData.stateMachineStateHash = keccak256(abi.encode("state", height));
        snapshot.forkId = FORK_ID;
        snapshot.blockHeight = height;
        snapshot.timestamp = 1000 + height;
    }

    /// one A-authored block at `height` committing `committed`, co-signed by B
    function _hop(uint256 height, StateSnapshot memory committed) internal pure returns (MilestoneProof memory hop) {
        Block memory hopBlock;
        hopBlock.transaction.header.channelId = CHANNEL_ID;
        hopBlock.transaction.header.participant = vm.addr(ALICE_KEY);
        hopBlock.transaction.header.forkId = FORK_ID;
        hopBlock.transaction.header.transactionCnt = height;
        hopBlock.transaction.header.timestamp = 1000 + height;
        hopBlock.previousBlockHash = keccak256(abi.encode("predecessor", height));
        hopBlock.stateSnapshotHash = keccak256(abi.encode(committed));
        uint256[] memory keys = new uint256[](2);
        keys[0] = ALICE_KEY;
        keys[1] = BOB_KEY;
        hop.blockConfirmations = new BlockConfirmation[](1);
        hop.blockConfirmations[0] = _blockConfirmation(abi.encode(hopBlock), keys);
    }

    function _walkInput(MilestoneProof memory hop, StateSnapshot memory hopSnapshot)
        internal
        pure
        returns (ProofWalkInput memory input)
    {
        input.channelId = CHANNEL_ID;
        input.forkId = FORK_ID;
        input.stateProof.milestones = new MilestoneProof[](1);
        input.stateProof.milestones[0] = hop;
        input.milestoneSnapshots = new StateSnapshot[](1);
        input.milestoneSnapshots[0] = hopSnapshot;
    }
}
