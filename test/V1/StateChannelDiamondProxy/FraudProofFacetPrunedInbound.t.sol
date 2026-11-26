pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {
    ErrorDisputeInboundMessageBlocksInvalid,
    INBOUND_FAILURE_FINAL_TARGET,
    RaceConditionBlockHeightTooOld
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    DisputeInboundAnchorBehindLatestState,
    DisputeInvalidBlockInStateProofApplyFraudProof
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/FraudProofTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// Genuine inbound A -> B adopted through the routed same-fork snapshot path, which keeps the head B and prunes the
/// blocks below it.
/// A forged-inbound proof is judged only above the snapshot's inbound head S.
/// A dispute tail that consumes an inbound block X before X is on chain (X's hash predicted) is killed in the kill
/// period; unkilled, X posted after the window cut makes the reduction revert; X posted before the cut counts once.
// test naming: test_<targetFunction>_<property>
contract FraudProofFacetPrunedInboundTest is DiamondHarness {
    /// a committed dispute whose tail consumes `topUp`, with the tail's latest snapshot and state
    struct TailDispute {
        Dispute dispute;
        StateSnapshot snapshot;
        bytes encodedState;
        MessageBlock topUp;
    }

    event ChannelStorageCleared(bytes32 indexed channelId, bytes32 firstPrunedInboundMessageBlockHash);

    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant OUTSIDER_PK = 0xBAD;
    // bob's top-up X that his dispute tail consumes
    uint256 internal constant TAIL_TOP_UP = 3;
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

        // step 2 - same-fork adoption consumes B, keeps B and prunes A and its ancestors
        (MilestoneProof[] memory proofs, StateSnapshot[] memory snapshots) =
            _makeSameForkSnapshot(CHANNEL, _participants(), _pks());
        vm.expectEmit(true, false, false, true, address(diamond));
        emit ChannelStorageCleared(CHANNEL, keccak256(abi.encode(inboundA)));
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

    // the walk ends on the kept snapshot head -> the output carries the snapshot's inbound height
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
        assertFalse(diamond.isUncommittedInboundMessageBlock(CHANNEL, inboundB), "kept head B at S");
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

    // an inbound block newer than the window's expiry is stepped over -> the walk ends on the kept head
    function test_reduce_inboundAfterWindowExpiry_fallsBackToSnapshotHeight() public {
        vm.warp(block.timestamp + 5);
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0] = _uploadDisputeCarrying(BOB_PK, ALICE_PK, inboundA);
        vm.warp(block.timestamp + diamond.getEvidenceTime() + 1);
        MessageBlock memory inboundC = _deposit(ALICE_PK, 3);
        assertEq(diamond.getChannelBalance(CHANNEL).latestInboundMessageBlockHash, keccak256(abi.encode(inboundC)));

        ReduceOutput memory output = diamond.reduce(disputes);

        assertEq(output.latestInboundMessageBlockHash, keccak256(abi.encode(inboundB)), "kept head B");
        assertEq(output.latestInboundMessageBlockHeight, snapshotHeight, "S");
    }

    // ---- a tail consuming inbound X before X is on chain: X posted after the window cut

    function test_applyDisputeFraudProofs_tailConsumingInboundNotYetPosted_anchorBehindProofKillsDisputer() public {
        TailDispute memory tail = _uploadTailConsumingTopUpAfter(_afterTheCut());
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeInboundAnchorBehindLatestState,
            participant: bob,
            dispute: tail.dispute,
            encodedProof: abi.encode(DisputeInboundAnchorBehindLatestState({latestStateSnapshot: tail.snapshot}))
        });

        vm.prank(alice);
        diamond.applyDisputeFraudProofs(proofs);

        _assertTailDisputerKilled();
    }

    function test_applyDisputeFraudProofs_tailConsumingInboundNotYetPosted_forgedInboundProofKillsDisputer() public {
        TailDispute memory tail = _uploadTailConsumingTopUpAfter(_afterTheCut());

        _applyNestedForgedInbound(alice, tail.dispute, BOB_PK, tail.topUp);

        _assertTailDisputerKilled();
    }

    // the cut stays at B, the tail's inbound head X is past it -> no run links X to B
    function test_reduceAndFinalize_unkilledTailConsumingInboundPostedAfterCut_revertsAndCommitsNothing() public {
        TailDispute memory tail = _uploadTailConsumingTopUpAfter(_afterTheCut());
        _warpPastKillPeriod();
        _postPredictedTopUp(tail);
        bytes32 topUpHash = keccak256(abi.encode(tail.topUp));
        bytes memory expectedRevert = abi.encodeWithSelector(
            ErrorDisputeInboundMessageBlocksInvalid.selector,
            topUpHash,
            keccak256(abi.encode(inboundB)),
            topUpHash,
            0,
            0,
            INBOUND_FAILURE_FINAL_TARGET
        );

        vm.expectRevert(expectedRevert);
        diamond.reduceAndFinalize(_committed(tail), tail.snapshot, tail.encodedState, new MessageBlock[](0), bytes32(0));

        (bytes32 reducedForkId,,) = diamond.getReducedResult(CHANNEL, forkId);
        assertEq(reducedForkId, bytes32(0), "no successor committed");
    }

    // X and then Y land inside the kill period -> the cut is Y; only Y is applied on top of the tail
    function test_reduceAndFinalize_unkilledTailConsumingInboundPostedBeforeCut_appliesEachDepositOnce() public {
        TailDispute memory tail = _uploadTailConsumingTopUpAfter(1);
        vm.warp(block.timestamp + 1);
        _postPredictedTopUp(tail);
        vm.warp(block.timestamp + 1);
        MessageBlock[] memory run = new MessageBlock[](1);
        run[0] = _deposit(ALICE_PK, 4);
        _warpPastKillPeriod();
        uint256 depositsBeforeX = diamond.getStateSnapshot(CHANNEL).snapshotData.totalDeposits.amount;

        SnapshotData memory output = _reducedSnapshotData(tail, run);
        bytes32 successorForkId = keccak256(abi.encode(output));
        diamond.reduceAndFinalize(_committed(tail), tail.snapshot, tail.encodedState, run, successorForkId);

        assertEq(output.latestInboundMessageBlockHash, keccak256(abi.encode(run[0])), "cut at Y");
        assertEq(output.latestInboundMessageBlockHeight, snapshotHeight + 2, "Y's height");
        // X (3) from the tail, Y (4) from the run; X counted twice would be 10
        assertEq(output.totalDeposits.amount, depositsBeforeX + 7, "each deposit once");
        (bytes32 reducedForkId,,) = diamond.getReducedResult(CHANNEL, forkId);
        assertEq(reducedForkId, successorForkId, "successor committed");
    }

    function _expectTooOld(uint256 forgedHeight) internal {
        vm.expectRevert(abi.encodeWithSelector(RaceConditionBlockHeightTooOld.selector, snapshotHeight, forgedHeight));
    }

    /// seconds after the upload at which X lands past the window cut (the kill-period end)
    function _afterTheCut() internal view returns (uint256) {
        return diamond.getEvidenceTime() + 1;
    }

    function _warpPastKillPeriod() internal {
        (,, uint256 killPeriodEnd,) = diamond.isKillPeriodExpired(CHANNEL, forkId);
        vm.warp(killPeriodEnd + 1);
    }

    /// bob predicts his top-up X of TAIL_TOP_UP landing `delay` seconds after the upload, then commits a dispute
    /// whose tail block consumes X
    function _uploadTailConsumingTopUpAfter(uint256 delay) internal returns (TailDispute memory tail) {
        vm.warp(block.timestamp + 5);
        tail.topUp = _predictInbound(BOB_PK, TAIL_TOP_UP, block.timestamp + delay);
        (tail.snapshot, tail.encodedState) = _tailSnapshotConsuming(tail.topUp);
        tail.dispute = _uploadDispute(BOB_PK, BOB_PK, tail.topUp, keccak256(abi.encode(tail.snapshot)));
    }

    /// bob posts the top-up his tail consumed; it lands with the predicted hash
    function _postPredictedTopUp(TailDispute memory tail) internal {
        MessageBlock memory posted = _deposit(BOB_PK, TAIL_TOP_UP);
        assertEq(keccak256(abi.encode(posted)), keccak256(abi.encode(tail.topUp)), "X lands as predicted");
    }

    function _committed(TailDispute memory tail) internal pure returns (Dispute[] memory disputes) {
        disputes = new Dispute[](1);
        disputes[0] = tail.dispute;
    }

    function _reducedSnapshotData(TailDispute memory tail, MessageBlock[] memory run)
        internal
        returns (SnapshotData memory output)
    {
        ReduceOutput memory reduced = diamond.reduce(_committed(tail));
        (output,,) = diamond.reduceOutputToSnapshotData(forkId, reduced, tail.snapshot, tail.encodedState, run);
    }

    function _assertTailDisputerKilled() internal view {
        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "disputer consuming the unposted block killed");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "killer kept");
        assertEq(diamond.getWindowCommitments(CHANNEL, forkId).length, 0, "dispute removed");
    }

    /// the inbound block `pk`'s deposit of `amount` appends at `timestamp`, read without keeping it on chain
    function _predictInbound(uint256 pk, uint256 amount, uint256 timestamp)
        internal
        returns (MessageBlock memory predicted)
    {
        uint256 chainState = vm.snapshotState();
        vm.warp(timestamp);
        predicted = _deposit(pk, amount);
        vm.revertToState(chainState);
    }

    /// the latest state of bob's tail: the chain snapshot plus his consumed top-up `topUp`
    function _tailSnapshotConsuming(MessageBlock memory topUp)
        internal
        view
        returns (StateSnapshot memory tail, bytes memory encodedState)
    {
        MathState memory state;
        state.number = 2;
        state.participants = _participants();
        state.balances = new uint256[](2);
        state.balances[0] = 5;
        state.balances[1] = 7 + TAIL_TOP_UP;
        encodedState = abi.encode(state);
        tail = diamond.getStateSnapshot(CHANNEL);
        tail.blockHeight = 2;
        tail.snapshotData.stateMachineStateHash = keccak256(encodedState);
        tail.snapshotData.latestInboundMessageBlockHash = keccak256(abi.encode(topUp));
        tail.snapshotData.latestInboundMessageBlockHeight = topUp.blockHeight;
        tail.snapshotData.totalDeposits.amount += TAIL_TOP_UP;
    }

    function _assertNobodySlashed() internal view {
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, alice), "author kept");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, bob), "eligible submitter kept");
        assertFalse(diamond.isParticipantSlashedOnChain(CHANNEL, outsider), "outsider kept");
    }

    function _applyForgedInbound(address submitter, uint256 authorPk, MessageBlock memory inbound) internal {
        FraudProof[] memory proofs = new FraudProof[](1);
        proofs[0] = _forgedInboundProof(authorPk, _blockCarrying(authorPk, inbound, bytes32(0)), inbound);
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
                    // the dispute's own carrier block at index 1
                    fraudProof: _forgedInboundProof(
                        authorPk, dispute.input.stateProof.milestones[0].blockConfirmations[1].signedBlock, inbound
                    ),
                    blockIndex: 1
                })
            )
        });
        vm.prank(killer);
        diamond.applyDisputeFraudProofs(proofs);
    }

    function _forgedInboundProof(uint256 authorPk, SignedBlock memory invalidBlock, MessageBlock memory inbound)
        internal
        pure
        returns (FraudProof memory)
    {
        return FraudProof({
            proofType: FraudProofType.ForgedInboundMessageBlock,
            participant: vm.addr(authorPk),
            encodedProof: abi.encode(
                ForgedInboundMessageBlockProof({invalidBlock: invalidBlock, forgedInboundMessageBlock: inbound})
            )
        });
    }

    /// `authorPk`'s signed block on the current fork carrying `inbound`, committing to `stateSnapshotHash`
    function _blockCarrying(uint256 authorPk, MessageBlock memory inbound, bytes32 stateSnapshotHash)
        internal
        view
        returns (SignedBlock memory)
    {
        Block memory carrier;
        carrier.stateSnapshotHash = stateSnapshotHash;
        carrier.transaction.header.channelId = CHANNEL;
        carrier.transaction.header.participant = vm.addr(authorPk);
        carrier.transaction.header.forkId = forkId;
        // one above the on-chain snapshot block (height 1) -> past the last milestone's protected boundary
        carrier.transaction.header.transactionCnt = 2;
        carrier.messageBlocks = new MessageBlock[](1);
        carrier.messageBlocks[0] = inbound;
        bytes memory encodedBlock = abi.encode(carrier);
        return SignedBlock({encodedBlock: encodedBlock, signature: _sign(authorPk, encodedBlock)});
    }

    /// `disputerPk` commits a dispute at the chain inbound head whose last milestone is a protected first block
    /// followed by one block of `authorPk` carrying `inbound`
    function _uploadDisputeCarrying(uint256 disputerPk, uint256 authorPk, MessageBlock memory inbound)
        internal
        returns (Dispute memory)
    {
        return _uploadDispute(disputerPk, authorPk, inbound, bytes32(0));
    }

    /// the same dispute whose latest block and latest state commit to the snapshot `latestStateSnapshotHash`
    function _uploadDispute(
        uint256 disputerPk,
        uint256 authorPk,
        MessageBlock memory inbound,
        bytes32 latestStateSnapshotHash
    ) internal returns (Dispute memory dispute) {
        ChannelBalance memory head = diamond.getChannelBalance(CHANNEL);
        dispute.input.channelId = CHANNEL;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(disputerPk);
        dispute.input.latestInboundMessageBlockHash = head.latestInboundMessageBlockHash;
        dispute.input.lastInboundMessageBlockHeight = head.latestInboundMessageBlockHeight;
        dispute.input.latestStateSnapshotHash = latestStateSnapshotHash;
        Block memory first;
        first.transaction.header.channelId = CHANNEL;
        first.transaction.header.participant = vm.addr(authorPk);
        first.transaction.header.forkId = forkId;
        first.transaction.header.transactionCnt = 1;
        bytes memory encodedFirst = abi.encode(first);
        dispute.input.stateProof.milestones = new MilestoneProof[](1);
        dispute.input.stateProof.milestones[0].blockConfirmations = new BlockConfirmation[](2);
        dispute.input.stateProof.milestones[0].blockConfirmations[0].signedBlock =
            SignedBlock({encodedBlock: encodedFirst, signature: _sign(authorPk, encodedFirst)});
        dispute.input.stateProof.milestones[0].blockConfirmations[1].signedBlock =
            _blockCarrying(authorPk, inbound, latestStateSnapshotHash);
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
