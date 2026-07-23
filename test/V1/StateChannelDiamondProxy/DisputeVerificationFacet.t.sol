pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerProxy} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelManagerProxy.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {
    RaceConditionDisputeKillPeriodExpired,
    RaceConditionDisputeTimeoutWindowCreatedTooEarly
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {_isKillPeriodExpired} from "../../../contracts/V1/StateChannelDiamondProxy/utils/DisputeUtils.sol";
import {
    DisputeBlockAuthorNotParticipant,
    DisputeInvalidBlockStructure,
    TimeoutCalldataPosted
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {BlockInvalidStateTransitionProof} from "../../../contracts/V1/types/FraudProofTypes.sol";
import {MathState, MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import "../../../contracts/V1/types/DataTypes.sol";

contract DisputeExpiryGuardHarness is DisputeFraudProofFacet, DisputeVerificationFacet {
    constructor() {
        evidenceTime = 10;
        disputeVerificationFacetAddress = address(this);
        stateProofFacetAddress = address(new StateProofFacet());
        utilityFacetAddress = address(new UtilityFacet());
    }

    function seedDispute(Dispute memory dispute, uint256 lastEvidenceSubmissionTimestamp) external {
        DisputeWindow storage window = disputeData[dispute.input.channelId].disputeWindowMap[dispute.input.forkId];
        window.evidence.creationTimestamp = lastEvidenceSubmissionTimestamp;
        window.evidence.lastEvidenceSubmissionTimestamp = lastEvidenceSubmissionTimestamp;
        window.evidence.disputeCommitments.push(keccak256(abi.encode(dispute)));
    }

    function observeWindow(bytes32 channelId, bytes32 forkId)
        external
        view
        returns (bool windowExists, bool isExpired)
    {
        DisputeWindow storage window = disputeData[channelId].disputeWindowMap[forkId];
        windowExists = window.evidence.creationTimestamp != 0;
        (isExpired,) = _isKillPeriodExpired(window, getEvidenceTime());
    }

    function commitmentCount(bytes32 channelId, bytes32 forkId) external view returns (uint256) {
        return disputeData[channelId].disputeWindowMap[forkId].evidence.disputeCommitments.length;
    }

    function handleBlockAuthorNotParticipant(bytes memory encodedProof, Dispute memory dispute)
        external
        view
        returns (address)
    {
        return _handleDisputeBlockAuthorNotParticipant(encodedProof, dispute);
    }
}

// test naming: test_<targetFunction>_<property>
contract DisputeVerificationFacetTest is DiamondHarness {
    StateChannelManagerProxy internal diamond;

    bytes32 internal constant CHANNEL_ID = keccak256("dv-channel");
    bytes32 internal constant FORK_ID = keccak256("dv-fork");

    function setUp() public {
        diamond = deployDiamond();
    }

    // reduce() must not OOB-panic when dispute.input.onChainSlashes.length exceeds
    // participants + pending (maxSlashCount).
    function test_reduce_oversizedOnChainSlashes_doesNotPanic() public {
        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;

        address[] memory fakeSlashes = new address[](20);
        for (uint256 i = 0; i < 20; i++) {
            fakeSlashes[i] = address(uint160(i + 1));
        }
        disputes[0].input.onChainSlashes = fakeSlashes;

        // maxSlashCount = 0 (no channel open → no participants) → extra slashes are skipped
        ReduceOutput memory out = diamond.reduce(disputes);
        assertEq(out.slashedParticipants.length, 0);
    }

    // slashedParticipants in the output must never exceed participants + pending,
    // regardless of what a dispute claims in onChainSlashes.
    function testFuzz_reduce_slashedParticipantsNeverExceedsMaxSlashCount(uint8 slashCount) public {
        vm.assume(slashCount > 0);

        Dispute[] memory disputes = new Dispute[](1);
        disputes[0].input.channelId = CHANNEL_ID;
        disputes[0].input.forkId = FORK_ID;

        address[] memory fakeSlashes = new address[](slashCount);
        for (uint256 i = 0; i < slashCount; i++) {
            fakeSlashes[i] = address(uint160(i + 1));
        }
        disputes[0].input.onChainSlashes = fakeSlashes;

        ReduceOutput memory out = diamond.reduce(disputes);
        // no open channel → maxSlashCount = 0; output must always be within that bound
        assertEq(out.slashedParticipants.length, 0);
    }

    function test_computeDisputeOutputState_timeoutOnly_removesTimedOutParticipant() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.timeout.participant = participants[2];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[0]);
        assertEq(output[1], participants[1]);
    }

    function test_computeDisputeOutputState_slashOnly_removesSlashedParticipant() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[1]);
        assertEq(output[1], participants[2]);
    }

    function test_computeDisputeOutputState_slashAndTimeout_ignoresTimeout() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];
        reducedOutput.timeout.participant = participants[2];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[1]);
        assertEq(output[1], participants[2]);
    }

    function test_computeDisputeOutputState_slashTimeoutAndSelfRemoval_ignoresTimeout() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];
        reducedOutput.timeout.participant = participants[2];
        reducedOutput.selfRemovals = new address[](1);
        reducedOutput.selfRemovals[0] = participants[1];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 1);
        assertEq(output[0], participants[2]);
    }

    function test_isInvalidBlockStructure_validSignedOnlyChain_returnsFalse() public {
        StateProof memory stateProof = _twoBlockStateProof();
        assertFalse(diamond.isInvalidBlockStructureInStateProof(stateProof, 0));
        assertFalse(diamond.isInvalidBlockStructureInStateProof(stateProof, 1));
    }

    function test_isInvalidBlockStructure_invalidSignature_returnsTrue() public {
        StateProof memory stateProof = _twoBlockStateProof();
        stateProof.signedBlocks[1].signature = hex"00";
        assertTrue(diamond.isInvalidBlockStructureInStateProof(stateProof, 1));
    }

    function test_isInvalidBlockStructure_brokenLink_returnsTrue() public {
        StateProof memory stateProof = _twoBlockStateProof();
        stateProof.signedBlocks[1] = _makeSignedBlock(2, CHANNEL_ID, FORK_ID, 1, 2, keccak256("wrong"));
        assertTrue(diamond.isInvalidBlockStructureInStateProof(stateProof, 1));
    }

    function test_isInvalidBlockStructure_skippedHeight_returnsTrue() public {
        StateProof memory stateProof = _twoBlockStateProof();
        stateProof.signedBlocks[1] =
            _makeSignedBlock(2, CHANNEL_ID, FORK_ID, 2, 2, keccak256(stateProof.signedBlocks[0].encodedBlock));
        assertTrue(diamond.isInvalidBlockStructureInStateProof(stateProof, 1));
    }

    function test_disputeWindowObservation_distinguishesAbsentActiveAndExpired() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        Dispute memory dispute = _structurallyInvalidDispute(keccak256("window"), address(0xA1));

        (bool exists, bool expired) = harness.observeWindow(CHANNEL_ID, dispute.input.forkId);
        assertFalse(exists);
        assertFalse(expired);

        harness.seedDispute(dispute, block.timestamp);
        (exists, expired) = harness.observeWindow(CHANNEL_ID, dispute.input.forkId);
        assertTrue(exists);
        assertFalse(expired);

        vm.warp(block.timestamp + 10);
        (exists, expired) = harness.observeWindow(CHANNEL_ID, dispute.input.forkId);
        assertTrue(exists);
        assertTrue(expired);
    }

    function test_applyDisputeFraudProofs_expiredDispute_reverts() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        Dispute memory dispute = _structurallyInvalidDispute(keccak256("expired-apply"), address(0xA1));
        harness.seedDispute(dispute, block.timestamp);
        vm.warp(block.timestamp + 10);

        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = _structuralProof(dispute);
        vm.expectRevert(RaceConditionDisputeKillPeriodExpired.selector);
        harness.applyDisputeFraudProofs(proofs);
        assertEq(harness.commitmentCount(CHANNEL_ID, dispute.input.forkId), 1);
    }

    function test_killDispute_expiredDispute_reverts() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        Dispute memory dispute = _structurallyInvalidDispute(keccak256("expired-kill"), address(0xA1));
        harness.seedDispute(dispute, block.timestamp);
        vm.warp(block.timestamp + 10);

        vm.expectRevert(RaceConditionDisputeKillPeriodExpired.selector);
        harness.killDispute(dispute);
        assertEq(harness.commitmentCount(CHANNEL_ID, dispute.input.forkId), 1);
    }

    function test_applyDisputeFraudProofs_mixedBatchWithExpiredItem_revertsAtomically() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        Dispute memory active = _structurallyInvalidDispute(keccak256("active"), address(0xA1));
        Dispute memory expired = _structurallyInvalidDispute(keccak256("expired"), address(0xA2));
        harness.seedDispute(expired, block.timestamp);
        vm.warp(block.timestamp + 10);
        harness.seedDispute(active, block.timestamp);

        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](2);
        proofs[0] = _structuralProof(active);
        proofs[1] = _structuralProof(expired);
        vm.expectRevert(RaceConditionDisputeKillPeriodExpired.selector);
        harness.applyDisputeFraudProofs(proofs);

        assertEq(harness.commitmentCount(CHANNEL_ID, active.input.forkId), 1);
        assertEq(harness.commitmentCount(CHANNEL_ID, expired.input.forkId), 1);
    }

    function test_uploadDispute_timeoutWindowCreatedBeforeEligibility_reverts() public {
        address[] memory participants = new address[](2);
        participants[0] = vm.addr(1);
        participants[1] = vm.addr(2);
        _openChannel(participants);
        (, StateSnapshot memory snapshot) = diamond.isChannelOpen(CHANNEL_ID);

        Dispute memory firstDispute;
        firstDispute.input.channelId = CHANNEL_ID;
        firstDispute.input.forkId = snapshot.forkId;
        firstDispute.input.disputer = participants[0];
        vm.prank(participants[0]);
        diamond.uploadDispute(_confirmation(firstDispute));

        uint256 eligibleAt = block.timestamp + 1;
        vm.warp(eligibleAt);
        Dispute memory timeoutDispute;
        timeoutDispute.input.channelId = CHANNEL_ID;
        timeoutDispute.input.forkId = snapshot.forkId;
        timeoutDispute.input.disputer = participants[1];
        timeoutDispute.input.timeout.participant = participants[0];
        timeoutDispute.input.timeout.minTimeStamp = eligibleAt;

        vm.prank(participants[1]);
        vm.expectRevert(RaceConditionDisputeTimeoutWindowCreatedTooEarly.selector);
        diamond.uploadDispute(_confirmation(timeoutDispute));
    }

    function test_validateTimeoutCalldataPostedProof_validProof_returnsTrueAndPreservesOriginForkId() public {
        (Dispute memory dispute, TimeoutCalldataPosted memory proof) = _timeoutCalldataPostedProof();

        assertNotEq(proof.latestStateSnapshot.forkId, proof.latestStateSnapshot.snapshotData.originForkId);
        assertTrue(diamond.validateTimeoutCalldataPostedProof(proof, dispute));
    }

    function test_validateTimeoutCalldataPostedProof_wrongOriginForkId_returnsFalse() public {
        (Dispute memory dispute, TimeoutCalldataPosted memory proof) = _timeoutCalldataPostedProof();
        proof.latestStateSnapshot.snapshotData.originForkId = keccak256("wrong-origin");

        assertFalse(diamond.validateTimeoutCalldataPostedProof(proof, dispute));
    }

    // A height-0 author gets an extra evidenceTime of grace on the calldata-posted
    // defense. graceWindow = p2p+agreement+chainFallback + evidenceTime; a post at
    // this edge is beyond the no-grace window and only validates because of the
    // +evidenceTime first-block grace. (Separate tests: each opens the channel once.)
    function _firstBlockGraceWindow() internal view returns (uint256) {
        return diamond.getEvidenceTime() + diamond.getP2pTime() + diamond.getAgreementTime()
            + diamond.getChainFallbackTime();
    }

    function test_validateTimeoutCalldataPostedProof_firstBlockGraceEdge_valid() public {
        require(diamond.getEvidenceTime() > 0, "evidenceTime is 0 - grace not observable");
        (Dispute memory dispute, TimeoutCalldataPosted memory proof) =
            _timeoutCalldataPostedProofPostedAfter(_firstBlockGraceWindow());
        assertTrue(
            diamond.validateTimeoutCalldataPostedProof(proof, dispute), "first-block grace edge rejected"
        );
    }

    function test_validateTimeoutCalldataPostedProof_pastFirstBlockGrace_invalid() public {
        require(diamond.getEvidenceTime() > 0, "evidenceTime is 0 - grace not observable");
        (Dispute memory dispute, TimeoutCalldataPosted memory proof) =
            _timeoutCalldataPostedProofPostedAfter(_firstBlockGraceWindow() + 1);
        assertFalse(
            diamond.validateTimeoutCalldataPostedProof(proof, dispute),
            "calldata posted past the grace window accepted"
        );
    }

    function test_disputeBlockAuthorNotParticipant_validOutsiderBlock_killsDisputer() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        (Dispute memory dispute, DisputeBlockAuthorNotParticipant memory proof,) =
            _disputeBlockAuthorNotParticipantProof();

        // The signature and block chain are structurally valid. The dedicated
        // proof is needed because the author is absent from both snapshots.
        assertFalse(diamond.isInvalidBlockStructureInStateProof(dispute.input.stateProof, 0));
        assertEq(harness.handleBlockAuthorNotParticipant(abi.encode(proof), dispute), dispute.input.disputer);
    }

    function test_disputeBlockAuthorNotParticipant_forgedResultingSnapshot_rejected() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        (Dispute memory dispute, DisputeBlockAuthorNotParticipant memory proof,) =
            _disputeBlockAuthorNotParticipantProof();
        proof.resultingStateSnapshot.snapshotData.stateMachineStateHash = keccak256("forged");
        assertEq(harness.handleBlockAuthorNotParticipant(abi.encode(proof), dispute), address(0));
    }

    function test_disputeBlockAuthorNotParticipant_authorInEitherSnapshot_rejected() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        (Dispute memory dispute, DisputeBlockAuthorNotParticipant memory proof, address signer) =
            _disputeBlockAuthorNotParticipantProof();
        proof.previousStateSnapshot.snapshotData.participants[0] = signer;
        Block memory invalidBlock = abi.decode(dispute.input.stateProof.signedBlocks[0].encodedBlock, (Block));
        invalidBlock.previousBlockHash = keccak256(abi.encode(proof.previousStateSnapshot));
        dispute.input.stateProof.signedBlocks[0].encodedBlock = abi.encode(invalidBlock);
        dispute.input.stateProof.signedBlocks[0].signature = _sign(1, abi.encode(invalidBlock));
        assertEq(harness.handleBlockAuthorNotParticipant(abi.encode(proof), dispute), address(0));

        (dispute, proof, signer) = _disputeBlockAuthorNotParticipantProof();
        proof.resultingStateSnapshot.snapshotData.participants[0] = signer;
        invalidBlock = abi.decode(dispute.input.stateProof.signedBlocks[0].encodedBlock, (Block));
        invalidBlock.stateSnapshotHash = keccak256(abi.encode(proof.resultingStateSnapshot));
        dispute.input.stateProof.signedBlocks[0].encodedBlock = abi.encode(invalidBlock);
        dispute.input.stateProof.signedBlocks[0].signature = _sign(1, abi.encode(invalidBlock));
        assertEq(harness.handleBlockAuthorNotParticipant(abi.encode(proof), dispute), address(0));
    }

    function test_blockInvalidStateTransition_wrongTurnWithCorrectSnapshot_slashesSigner() public {
        address[] memory participants = new address[](2);
        participants[0] = vm.addr(1);
        participants[1] = vm.addr(2);
        _openChannel(participants);

        MathState memory previousState;
        previousState.participants = participants;
        previousState.balances = new uint256[](2);
        previousState.currentTurnIndex = 0;
        bytes memory encodedPreviousState = abi.encode(previousState);

        StateSnapshot memory previousSnapshot;
        previousSnapshot.forkId = FORK_ID;
        previousSnapshot.snapshotData.stateMachineStateHash = keccak256(encodedPreviousState);
        previousSnapshot.snapshotData.participants = participants;

        MathState memory resultingState = previousState;
        resultingState.number = 1;
        resultingState.currentTurnIndex = 1;
        StateSnapshot memory resultingSnapshot;
        resultingSnapshot.snapshotData.stateMachineStateHash = keccak256(abi.encode(resultingState));
        resultingSnapshot.snapshotData.participants = participants;
        resultingSnapshot.snapshotData.originForkId = FORK_ID;
        resultingSnapshot.blockHeight = 1;
        resultingSnapshot.timestamp = 1;

        Block memory wrongTurnBlock;
        wrongTurnBlock.transaction.header.channelId = CHANNEL_ID;
        wrongTurnBlock.transaction.header.participant = participants[1];
        wrongTurnBlock.transaction.header.forkId = FORK_ID;
        wrongTurnBlock.transaction.header.timestamp = 1;
        wrongTurnBlock.transaction.body.data = abi.encodeCall(MathStateMachine.add, (1));
        wrongTurnBlock.previousBlockHash = keccak256(abi.encode(previousSnapshot));
        wrongTurnBlock.stateSnapshotHash = keccak256(abi.encode(resultingSnapshot));
        bytes memory encodedBlock = abi.encode(wrongTurnBlock);

        BlockInvalidStateTransitionProof memory invalidTransition = BlockInvalidStateTransitionProof({
            invalidBlock: SignedBlock({encodedBlock: encodedBlock, signature: _sign(2, encodedBlock)}),
            previousBlock: SignedBlock({encodedBlock: "", signature: ""}),
            previousBlockStateSnapshot: previousSnapshot,
            previousStateStateMachineState: encodedPreviousState
        });
        FraudProof[] memory proofs = new FraudProof[](1);
        proofs[0] = FraudProof({
            proofType: FraudProofType.BlockInvalidStateTransition,
            encodedProof: abi.encode(invalidTransition),
            participant: participants[1]
        });

        diamond.applyFraudProofs(proofs, FraudProofVerificationContext({channelId: CHANNEL_ID}));
        assertTrue(diamond.isParticipantSlashedOnChain(CHANNEL_ID, participants[1]));
    }

    function _twoBlockStateProof() internal pure returns (StateProof memory stateProof) {
        stateProof.signedBlocks = new SignedBlock[](2);
        stateProof.signedBlocks[0] = _makeSignedBlock(1, CHANNEL_ID, FORK_ID, 0, 1, bytes32(0));
        stateProof.signedBlocks[1] =
            _makeSignedBlock(2, CHANNEL_ID, FORK_ID, 1, 2, keccak256(stateProof.signedBlocks[0].encodedBlock));
    }

    function _structurallyInvalidDispute(bytes32 forkId, address disputer)
        internal
        pure
        returns (Dispute memory dispute)
    {
        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = forkId;
        dispute.input.disputer = disputer;
        dispute.input.stateProof.signedBlocks = new SignedBlock[](1);
        dispute.input.stateProof.signedBlocks[0] = _makeSignedBlock(1, CHANNEL_ID, forkId, 0, 1, bytes32(0));
        dispute.input.stateProof.signedBlocks[0].signature = hex"00";
    }

    function _structuralProof(Dispute memory dispute) internal pure returns (DisputeFraudProof memory proof) {
        proof.dispute = dispute;
        proof.proofType = DisputeFraudProofType.DisputeInvalidBlockStructure;
        proof.encodedProof = abi.encode(DisputeInvalidBlockStructure({blockIndexInUnfinalizedPartOfStateProof: 0}));
        proof.participant = dispute.input.disputer;
    }

    function _confirmation(Dispute memory dispute) internal pure returns (DisputeConfirmation memory confirmation) {
        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        confirmation.signatures = new bytes[](0);
    }

    function _timeoutCalldataPostedProof()
        internal
        returns (Dispute memory dispute, TimeoutCalldataPosted memory proof)
    {
        return _timeoutCalldataPostedProofPostedAfter(0);
    }

    function _timeoutCalldataPostedProofPostedAfter(uint256 postDelay)
        internal
        returns (Dispute memory dispute, TimeoutCalldataPosted memory proof)
    {
        address[] memory participants = new address[](2);
        participants[0] = vm.addr(1);
        participants[1] = vm.addr(2);
        _openChannel(participants);
        // genesis timestamp is fixed at channel open; warp forward so the calldata
        // is posted `postDelay` seconds after genesis - exercises the first-block
        // grace band on the timeout-calldata-posted defense.
        vm.warp(block.timestamp + postDelay);
        (, StateSnapshot memory latestSnapshot) = diamond.isChannelOpen(CHANNEL_ID);

        MathState memory latestState;
        latestState.participants = participants;
        latestState.balances = new uint256[](participants.length);
        bytes memory encodedLatestState = abi.encode(latestState);

        MathState memory resultingState = latestState;
        resultingState.number = 1;
        resultingState.currentTurnIndex = 1;
        StateSnapshot memory resultingSnapshot = abi.decode(abi.encode(latestSnapshot), (StateSnapshot));
        resultingSnapshot.snapshotData.stateMachineStateHash = keccak256(abi.encode(resultingState));
        resultingSnapshot.blockHeight = latestSnapshot.blockHeight + 1;
        resultingSnapshot.timestamp = block.timestamp;

        Block memory postedBlock;
        postedBlock.transaction.header.channelId = CHANNEL_ID;
        postedBlock.transaction.header.participant = participants[0];
        postedBlock.transaction.header.forkId = latestSnapshot.forkId;
        postedBlock.transaction.header.timestamp = block.timestamp;
        postedBlock.transaction.body.data = abi.encodeCall(MathStateMachine.add, (1));
        postedBlock.previousBlockHash = keccak256(abi.encode(latestSnapshot));
        postedBlock.stateSnapshotHash = keccak256(abi.encode(resultingSnapshot));
        bytes memory encodedPostedBlock = abi.encode(postedBlock);
        SignedBlock memory signedPostedBlock =
            SignedBlock({encodedBlock: encodedPostedBlock, signature: _sign(1, encodedPostedBlock)});

        vm.prank(participants[0]);
        diamond.postBlockCalldata(signedPostedBlock, block.timestamp);

        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = latestSnapshot.forkId;
        dispute.input.disputer = participants[1];
        dispute.input.timeout.blockHeight = 0;
        dispute.input.timeout.participant = participants[0];

        proof.genesisStateSnapshotData = latestSnapshot.snapshotData;
        proof.latestStateSnapshot = latestSnapshot;
        proof.latestStateStateMachineState = encodedLatestState;
        proof.postedBlock = signedPostedBlock;
        proof.onChainTimestamp = block.timestamp;
    }

    function _disputeBlockAuthorNotParticipantProof()
        internal
        pure
        returns (Dispute memory dispute, DisputeBlockAuthorNotParticipant memory proof, address signer)
    {
        signer = vm.addr(1);
        StateSnapshot memory previousSnapshot;
        previousSnapshot.snapshotData.participants = new address[](1);
        previousSnapshot.snapshotData.participants[0] = address(0xA1);
        StateSnapshot memory resultingSnapshot;
        resultingSnapshot.snapshotData.participants = new address[](1);
        resultingSnapshot.snapshotData.participants[0] = address(0xA2);

        Block memory invalidBlock;
        invalidBlock.transaction.header.channelId = CHANNEL_ID;
        invalidBlock.transaction.header.participant = signer;
        invalidBlock.transaction.header.forkId = FORK_ID;
        invalidBlock.transaction.header.transactionCnt = 0;
        invalidBlock.previousBlockHash = keccak256(abi.encode(previousSnapshot));
        invalidBlock.stateSnapshotHash = keccak256(abi.encode(resultingSnapshot));
        bytes memory encodedBlock = abi.encode(invalidBlock);
        dispute.input.channelId = CHANNEL_ID;
        dispute.input.forkId = FORK_ID;
        dispute.input.disputer = address(0xD1);
        dispute.input.stateProof.signedBlocks = new SignedBlock[](1);
        dispute.input.stateProof.signedBlocks[0] =
            SignedBlock({encodedBlock: encodedBlock, signature: _sign(1, encodedBlock)});
        proof = DisputeBlockAuthorNotParticipant({
            blockIndexInUnfinalizedPartOfStateProof: 0,
            previousBlock: SignedBlock({encodedBlock: "", signature: ""}),
            previousStateSnapshot: previousSnapshot,
            resultingStateSnapshot: resultingSnapshot
        });
    }

    function _openChannel(address[] memory participants) internal {
        OpenChannel memory openChannel;
        openChannel.channelId = CHANNEL_ID;
        openChannel.participants = participants;
        openChannel.balances = new Balance[](participants.length);
        openChannel.deadlineTimestamp = block.timestamp + 1 days;
        openChannel.isAtomic = true;
        bytes memory encodedOpenChannel = abi.encode(openChannel);
        bytes[] memory signatures = new bytes[](participants.length);
        for (uint256 i = 0; i < participants.length; i++) {
            signatures[i] = _sign(i + 1, encodedOpenChannel);
        }
        diamond.open(OpenChannelConfirmation({encodedOpenChannel: encodedOpenChannel, signatures: signatures}));
    }

    function _participants() internal pure returns (address[] memory participants) {
        participants = new address[](3);
        participants[0] = address(0xA1);
        participants[1] = address(0xA2);
        participants[2] = address(0xA3);
    }

    function _outputParticipants(ReduceOutput memory reducedOutput, address[] memory participants)
        internal
        returns (address[] memory)
    {
        MathState memory state;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        StateSnapshot memory snapshot;
        bytes memory encodedState = abi.encode(state);
        snapshot.snapshotData.stateMachineStateHash = keccak256(encodedState);
        MessageBlock[] memory inboundMessageBlocks = new MessageBlock[](0);
        (, bytes memory encodedModifiedState,) = diamond.reduceOutputToSnapshotData(
            keccak256(abi.encode(snapshot.snapshotData)), reducedOutput, snapshot, encodedState, inboundMessageBlocks
        );
        return abi.decode(encodedModifiedState, (MathState)).participants;
    }
}
