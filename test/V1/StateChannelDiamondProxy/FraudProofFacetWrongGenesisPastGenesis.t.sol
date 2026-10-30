pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {
    RaceConditionBlockHeightTooOld,
    RaceConditionDisputeWindowNotOpen
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/FraudProofTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// WrongGenesis on the routed diamond, judged against the fork's on-chain snapshot. While that snapshot is the
/// fork's genesis the proof is judged; once a same-fork adoption moved it past genesis the chain no longer holds
/// the genesis, so the proof reverts and slashes nobody.
// test naming: test_<targetFunction>_<property>
contract FraudProofFacetWrongGenesisPastGenesisTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant OUTSIDER_PK = 0xBAD;
    bytes32 internal constant CHANNEL = keccak256("wrong-genesis-past-genesis");

    address internal alice;
    address internal bob;
    address internal outsider;
    StateSnapshot internal genesis;

    function setUp() public {
        diamond = deployDiamond();
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        outsider = vm.addr(OUTSIDER_PK);
        _openChannel(CHANNEL, _pks());
        genesis = diamond.getStateSnapshot(CHANNEL);
    }

    function test_applyFraudProofs_unlinkedBlockZeroAtGenesis_slashesAuthor() public {
        _applyWrongGenesis(bob, _blockZero(bytes32(uint256(1))));

        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "unlinked block 0 author slashed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "prover kept");
    }

    // a linked block 0 is not this branch's fraud: the handler goes on to the origin window, which an opened
    // channel's genesis has none of
    function test_applyFraudProofs_linkedBlockZeroAtGenesis_revertsAndSlashesNobody() public {
        vm.expectRevert(abi.encodeWithSelector(RaceConditionDisputeWindowNotOpen.selector, CHANNEL, bytes32(0)));
        _applyWrongGenesis(bob, _blockZero(keccak256(abi.encode(genesis))));

        _assertNobodySlashed();
    }

    function test_applyFraudProofs_unlinkedBlockZeroPastGenesis_revertsAndSlashesNobody() public {
        uint256 snapshotHeight = _adoptPastGenesis();

        vm.expectRevert(abi.encodeWithSelector(RaceConditionBlockHeightTooOld.selector, snapshotHeight, 0));
        _applyWrongGenesis(bob, _blockZero(bytes32(uint256(1))));

        _assertNobodySlashed();
    }

    function test_applyFraudProofs_linkedBlockZeroPastGenesisFromOutsider_revertsAndSlashesNobody() public {
        uint256 snapshotHeight = _adoptPastGenesis();

        vm.expectRevert(abi.encodeWithSelector(RaceConditionBlockHeightTooOld.selector, snapshotHeight, 0));
        _applyWrongGenesis(outsider, _blockZero(keccak256(abi.encode(genesis))));

        _assertNobodySlashed();
    }

    // any block-0 link, any submitter -> past genesis nobody is ever slashed
    function testFuzz_applyFraudProofs_blockZeroPastGenesisNeverSlashes(bytes32 previousBlockHash, bool eligible)
        public
    {
        uint256 snapshotHeight = _adoptPastGenesis();

        vm.expectRevert(abi.encodeWithSelector(RaceConditionBlockHeightTooOld.selector, snapshotHeight, 0));
        _applyWrongGenesis(eligible ? bob : outsider, _blockZero(previousBlockHash));

        _assertNobodySlashed();
    }

    /// same-fork adoption at height 1 -> the chain snapshot is past the fork's genesis
    function _adoptPastGenesis() internal returns (uint256 snapshotHeight) {
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, _participants(), _pks());
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));
        StateSnapshot memory snapshot = diamond.getStateSnapshot(CHANNEL);
        assertEq(snapshot.forkId, genesis.forkId, "still on the genesis fork");
        assertTrue(keccak256(abi.encode(snapshot)) != keccak256(abi.encode(genesis)), "snapshot moved past genesis");
        snapshotHeight = snapshot.blockHeight;
    }

    /// alice's signed block 0 on the genesis fork with `previousBlockHash`
    function _blockZero(bytes32 previousBlockHash) internal view returns (SignedBlock memory) {
        return _makeSignedGenesisBlock(ALICE_PK, CHANNEL, genesis.forkId, block.timestamp, previousBlockHash);
    }

    function _applyWrongGenesis(address submitter, SignedBlock memory blockZero) internal {
        FraudProof[] memory proofs = new FraudProof[](1);
        proofs[0] = FraudProof({
            proofType: FraudProofType.WrongGenesis,
            participant: alice,
            encodedProof: abi.encode(WrongGenesisProof({invalidBlock: blockZero, genesisSnapshot: genesis}))
        });
        vm.prank(submitter);
        diamond.applyFraudProofs(proofs, FraudProofVerificationContext({channelId: CHANNEL}));
    }

    function _assertNobodySlashed() internal view {
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "author slashed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "eligible prover slashed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, outsider), "outsider slashed");
    }

    function _pks() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }

    function _participants() internal view returns (address[] memory participants) {
        participants = new address[](2);
        participants[0] = alice;
        participants[1] = bob;
    }
}
