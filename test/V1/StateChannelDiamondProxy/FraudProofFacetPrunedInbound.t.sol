pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {RaceConditionBlockHeightTooOld} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {DisputeInvalidBlockInStateProofApplyFraudProof} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/FraudProofTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// Genuine inbound A -> B adopted through the routed same-fork snapshot path, which prunes the consumed chain.
/// A forged-inbound proof is judged only above the snapshot's inbound head S.
// test naming: test_<targetFunction>_<property>
contract FraudProofFacetPrunedInboundTest is DiamondHarness {
    event ChannelStorageCleared(bytes32 indexed channelId, bytes32 latestInboundMessageBlockHash);

    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant OUTSIDER_PK = 0xBAD;
    bytes32 internal constant CHANNEL = keccak256("pruned-inbound");

    address internal alice;
    address internal bob;
    address internal outsider;
    MessageBlock internal inboundA;
    MessageBlock internal inboundB;
    uint256 internal snapshotHeight;
    bytes32 internal forkId;

    function setUp() public {
        diamond = deployDiamond();
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        outsider = vm.addr(OUTSIDER_PK);
        _openChannel(CHANNEL, _pks());

        // step 1 - genuine inbound A then B land on chain
        inboundA = _deposit(ALICE_PK, 5);
        inboundB = _deposit(BOB_PK, 7);
        assertEq(inboundB.previousBlockHash, keccak256(abi.encode(inboundA)), "B links to A");

        // step 2 - same-fork adoption consumes B and prunes B, A and their ancestors
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, _participants(), _pks());
        vm.expectEmit(true, false, false, true, address(diamond));
        emit ChannelStorageCleared(CHANNEL, keccak256(abi.encode(inboundB)));
        diamond.updateStateSnapshotSameFork(CHANNEL, proofs, snapshots, new MessageBlock[](0));

        StateSnapshot memory snapshot = diamond.getStateSnapshot(CHANNEL);
        snapshotHeight = snapshot.snapshotData.latestInboundMessageBlockHeight;
        forkId = snapshot.forkId;
        assertEq(snapshot.snapshotData.latestInboundMessageBlockHash, keccak256(abi.encode(inboundB)), "B adopted");
        assertEq(snapshotHeight, inboundB.blockHeight, "S is B's height");
        assertEq(inboundA.blockHeight + 1, snapshotHeight, "A sits below S");
    }

    function test_applyFraudProofs_prunedGenuineInboundFromOutsider_revertsAndSlashesNobody() public {
        _expectTooOld(inboundA.blockHeight);
        _applyForgedInbound(outsider, ALICE_PK, inboundA);

        _assertNobodySlashed();
    }

    function test_applyFraudProofs_prunedGenuineInboundFromEligibleSubmitter_revertsAndSlashesNobody() public {
        _expectTooOld(inboundA.blockHeight);
        _applyForgedInbound(bob, ALICE_PK, inboundA);

        _assertNobodySlashed();
    }

    function test_applyFraudProofs_snapshotHeadInboundAtHeightS_revertsAndSlashesNobody() public {
        _expectTooOld(inboundB.blockHeight);
        _applyForgedInbound(bob, ALICE_PK, inboundB);

        _assertNobodySlashed();
    }

    function test_applyFraudProofs_genuineInboundAtHeightSPlusOne_slashesSubmitterNotAuthor() public {
        MessageBlock memory inboundC = _deposit(ALICE_PK, 3);
        assertEq(inboundC.blockHeight, snapshotHeight + 1, "C sits at S + 1");

        _applyForgedInbound(bob, ALICE_PK, inboundC);

        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "honest author kept");
        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "false prover slashed");
    }

    function test_applyFraudProofs_forgedInboundAtHeightSPlusOne_slashesAuthor() public {
        MessageBlock memory forged = _fabricatedInbound(snapshotHeight + 1, keccak256(abi.encode(inboundB)), 1, 99);

        _applyForgedInbound(outsider, ALICE_PK, forged);

        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "forging author slashed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "bystander kept");
    }

    // full height range -> at or below S never judged, above S always the author's fraud
    function testFuzz_applyFraudProofs_fabricatedInboundJudgedOnlyAboveSnapshotHead(
        uint256 height,
        bytes32 previousBlockHash,
        uint256 timestamp,
        uint256 amount,
        bool eligibleSubmitter
    ) public {
        MessageBlock memory forged = _fabricatedInbound(height, previousBlockHash, timestamp, amount);
        address submitter = eligibleSubmitter ? bob : outsider;

        if (height <= snapshotHeight) {
            _expectTooOld(height);
            _applyForgedInbound(submitter, ALICE_PK, forged);
            _assertNobodySlashed();
        } else {
            _applyForgedInbound(submitter, ALICE_PK, forged);
            assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "forging author slashed");
            assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "submitter kept");
        }
    }

    // any pruned genuine block, any submitter -> refused
    function testFuzz_applyFraudProofs_prunedGenuineInboundNeverSlashes(bool useA, bool eligibleSubmitter) public {
        MessageBlock memory genuine = useA ? inboundA : inboundB;

        _expectTooOld(genuine.blockHeight);
        _applyForgedInbound(eligibleSubmitter ? bob : outsider, ALICE_PK, genuine);

        _assertNobodySlashed();
    }

    function test_applyDisputeFraudProofs_prunedGenuineInboundInStateProof_revertsAndKeepsDispute() public {
        Dispute memory dispute = _uploadDisputeCarrying(BOB_PK, ALICE_PK, inboundA);

        _expectTooOld(inboundA.blockHeight);
        _applyNestedForgedInbound(alice, dispute, ALICE_PK, inboundA);

        _assertNobodySlashed();
        assertEq(diamond.getWindowCommitments(CHANNEL, dispute.input.forkId).length, 1, "dispute still committed");
    }

    function test_applyDisputeFraudProofs_forgedInboundAboveSnapshotHeadInStateProof_killsDisputer() public {
        MessageBlock memory forged = _fabricatedInbound(snapshotHeight + 1, keccak256(abi.encode(inboundB)), 1, 99);
        Dispute memory dispute = _uploadDisputeCarrying(BOB_PK, BOB_PK, forged);

        _applyNestedForgedInbound(alice, dispute, BOB_PK, forged);

        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "disputer carrying the forgery killed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "killer kept");
        assertEq(diamond.getWindowCommitments(CHANNEL, dispute.input.forkId).length, 0, "dispute removed");
    }

    // the walk ends on the pruned snapshot head -> its height comes from the snapshot, not deleted storage
    function test_reduce_afterSameForkPrune_keepsSnapshotInboundHeight() public {
        vm.warp(block.timestamp + 5);
        Dispute memory dispute = _uploadDisputeCarrying(BOB_PK, ALICE_PK, inboundA);
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0] = dispute;

        ReduceOutput memory output = diamond.reduce(disputes);

        assertEq(output.latestInboundMessageBlockHash, keccak256(abi.encode(inboundB)), "head kept");
        assertEq(output.latestInboundMessageBlockHeight, snapshotHeight, "height kept");
    }

    // the routed view answers the forged-inbound question for each side of S
    function test_isUncommittedInboundMessageBlock_judgesOnlyAbsentBlocksAboveSnapshotHead() public {
        MessageBlock memory inboundC = _deposit(ALICE_PK, 3);
        MessageBlock memory fabricated = _fabricatedInbound(snapshotHeight + 1, keccak256(abi.encode(inboundB)), 1, 99);

        assertFalse(diamond.isUncommittedInboundMessageBlock(CHANNEL, inboundA), "pruned A below S");
        assertFalse(diamond.isUncommittedInboundMessageBlock(CHANNEL, inboundB), "pruned head B at S");
        assertFalse(diamond.isUncommittedInboundMessageBlock(CHANNEL, inboundC), "stored C at S + 1");
        assertTrue(diamond.isUncommittedInboundMessageBlock(CHANNEL, fabricated), "fabricated at S + 1");
    }

    // the walk stops on a stored block above S -> its own height
    function test_reduce_storedInboundAboveSnapshotHead_keepsItsHeight() public {
        MessageBlock memory inboundC = _deposit(ALICE_PK, 3);
        vm.warp(block.timestamp + 5);
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0] = _uploadDisputeCarrying(BOB_PK, ALICE_PK, inboundA);

        ReduceOutput memory output = diamond.reduce(disputes);

        assertEq(output.latestInboundMessageBlockHash, keccak256(abi.encode(inboundC)), "head C");
        assertEq(output.latestInboundMessageBlockHeight, snapshotHeight + 1, "C's height");
    }

    // an inbound block newer than the window's expiry is stepped over -> the walk ends on the pruned head
    function test_reduce_inboundAfterWindowExpiry_fallsBackToSnapshotHeight() public {
        vm.warp(block.timestamp + 5);
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0] = _uploadDisputeCarrying(BOB_PK, ALICE_PK, inboundA);
        vm.warp(block.timestamp + diamond.getEvidenceTime() + 1);
        MessageBlock memory inboundC = _deposit(ALICE_PK, 3);
        assertEq(diamond.getChannelBalance(CHANNEL).latestInboundMessageBlockHash, keccak256(abi.encode(inboundC)));

        ReduceOutput memory output = diamond.reduce(disputes);

        assertEq(output.latestInboundMessageBlockHash, keccak256(abi.encode(inboundB)), "pruned head B");
        assertEq(output.latestInboundMessageBlockHeight, snapshotHeight, "S");
    }

    function _expectTooOld(uint256 forgedHeight) internal {
        vm.expectRevert(abi.encodeWithSelector(RaceConditionBlockHeightTooOld.selector, snapshotHeight, forgedHeight));
    }

    function _assertNobodySlashed() internal view {
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "author kept");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "eligible submitter kept");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, outsider), "outsider kept");
    }

    function _applyForgedInbound(address submitter, uint256 authorPk, MessageBlock memory inbound) internal {
        FraudProof[] memory proofs = new FraudProof[](1);
        proofs[0] = _forgedInboundProof(authorPk, inbound);
        vm.prank(submitter);
        diamond.applyFraudProofs(proofs, FraudProofVerificationContext({channelId: CHANNEL}));
    }

    function _applyNestedForgedInbound(
        address killer,
        Dispute memory dispute,
        uint256 authorPk,
        MessageBlock memory inbound
    ) internal {
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            participant: dispute.input.disputer,
            dispute: dispute,
            encodedProof: abi.encode(
                DisputeInvalidBlockInStateProofApplyFraudProof({
                    fraudProof: _forgedInboundProof(authorPk, inbound),
                    blockIndexInUnfinalizedPartOfStateProof: 0
                })
            )
        });
        vm.prank(killer);
        diamond.applyDisputeFraudProofs(proofs);
    }

    function _forgedInboundProof(uint256 authorPk, MessageBlock memory inbound)
        internal
        view
        returns (FraudProof memory)
    {
        return FraudProof({
            proofType: FraudProofType.ForgedInboundMessageBlock,
            participant: vm.addr(authorPk),
            encodedProof: abi.encode(
                ForgedInboundMessageBlockProof({
                    invalidBlock: _blockCarrying(authorPk, inbound),
                    forgedInboundMessageBlock: inbound
                })
            )
        });
    }

    /// `authorPk`'s signed block on the current fork carrying `inbound`
    function _blockCarrying(uint256 authorPk, MessageBlock memory inbound) internal view returns (SignedBlock memory) {
        Block memory carrier;
        carrier.transaction.header.channelId = CHANNEL;
        carrier.transaction.header.participant = vm.addr(authorPk);
        carrier.transaction.header.forkId = forkId;
        carrier.transaction.header.transactionCnt = 1;
        carrier.messageBlocks = new MessageBlock[](1);
        carrier.messageBlocks[0] = inbound;
        bytes memory encodedBlock = abi.encode(carrier);
        return SignedBlock({encodedBlock: encodedBlock, signature: _sign(authorPk, encodedBlock)});
    }

    /// `disputerPk` commits a dispute at the chain inbound head whose unfinalized state proof is one block of
    /// `authorPk` carrying `inbound`
    function _uploadDisputeCarrying(uint256 disputerPk, uint256 authorPk, MessageBlock memory inbound)
        internal
        returns (Dispute memory dispute)
    {
        ChannelBalance memory head = diamond.getChannelBalance(CHANNEL);
        dispute.input.channelId = CHANNEL;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(disputerPk);
        dispute.input.latestInboundMessageBlockHash = head.latestInboundMessageBlockHash;
        dispute.input.lastInboundMessageBlockHeight = head.latestInboundMessageBlockHeight;
        dispute.input.stateProof.signedBlocks = new SignedBlock[](1);
        dispute.input.stateProof.signedBlocks[0] = _blockCarrying(authorPk, inbound);
        DisputeConfirmation memory confirmation;
        confirmation.signedDispute =
            SignedDispute({encodedDispute: abi.encode(dispute), signature: _sign(disputerPk, abi.encode(dispute))});
        vm.prank(vm.addr(disputerPk));
        diamond.uploadDispute(confirmation);
        assertEq(diamond.getWindowCommitments(CHANNEL, dispute.input.forkId).length, 1, "dispute committed");
    }

    function _deposit(uint256 pk, uint256 amount) internal returns (MessageBlock memory messageBlock) {
        JoinChannel[] memory joins = new JoinChannel[](1);
        joins[0] = JoinChannel({
            channelId: CHANNEL,
            participant: vm.addr(pk),
            deadlineTimestamp: block.timestamp + 1 days,
            balance: Balance({amount: amount, data: ""})
        });
        vm.prank(address(diamond));
        (messageBlock,,) = diamond.depositAssetsComposable(joins, true);
    }

    function _fabricatedInbound(uint256 height, bytes32 previousBlockHash, uint256 timestamp, uint256 amount)
        internal
        view
        returns (MessageBlock memory forged)
    {
        forged.previousBlockHash = previousBlockHash;
        forged.blockHeight = height;
        forged.timestamp = timestamp;
        forged.messages = new Message[](1);
        forged.messages[0].participant = alice;
        forged.messages[0].balance = Balance({amount: amount, data: ""});
        forged.totalBalance = Balance({amount: amount, data: ""});
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
