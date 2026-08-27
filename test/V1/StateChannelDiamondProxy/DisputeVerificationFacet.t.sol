pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {DisputeVerificationFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeVerificationFacet.sol";
import {StateProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/StateProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {StateChannelCommon} from "../../../contracts/V1/StateChannelDiamondProxy/StateChannelCommon.sol";
import {
    ErrorDisputeInboundMessageBlocksInvalid,
    INBOUND_FAILURE_FINAL_TARGET,
    INBOUND_FAILURE_HASH_LINK,
    INBOUND_FAILURE_HEIGHT_SEQUENCE,
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
import {AStateMachine} from "../../../contracts/V1/AStateMachine.sol";
import {MESSAGE_TYPE_EXIT} from "../../../contracts/V1/types/MessageTypeHashes.sol";
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
        (isExpired,) = _isKillPeriodExpired(window, _getEvidenceTime());
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

    /// Exposes the internal slash-window read so the shrink behaviour can be asserted directly.
    function getOnChainSlashedParticipantsUpToTimestamp(bytes32 channelId, uint256 timestamp)
        external
        view
        returns (address[] memory)
    {
        return _getOnChainSlashedParticipantsUpToTimestamp(channelId, timestamp);
    }
}

/// Exposes the internal inbound walk so its report can be asserted directly.
contract InboundVerificationHarness is StateChannelCommon {
    function verifyInboundMessageBlocks(
        bytes32 previousInboundMessageBlockHash,
        bytes32 latestInboundMessageBlockHash,
        MessageBlock[] memory inboundMessageBlocks
    ) external pure returns (bool, bytes32, uint256, uint8) {
        return _verifyInboundMessageBlocks(
            previousInboundMessageBlockHash, latestInboundMessageBlockHash, inboundMessageBlocks
        );
    }
}

/// Wires SM + Utility so public computeDisputeOutputState (and _calculateRemovals) can be exercised.
contract DisputeOutputStateHarness is DisputeVerificationFacet {
    constructor(AStateMachine sm, address util) {
        stateMachineImplementation = sm;
        utilityFacetAddress = util;
    }
}

// test naming: test_<targetFunction>_<property>
contract DisputeVerificationFacetTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;
    InboundVerificationHarness internal verificationHarness;
    DisputeOutputStateHarness internal outputHarness;

    bytes32 internal constant CHANNEL_ID = keccak256("dv-channel");
    bytes32 internal constant FORK_ID = keccak256("dv-fork");
    bytes32 internal constant SNAPSHOT_HEAD = keccak256("dv-inbound-head");

    function setUp() public {
        diamond = deployDiamond();
        verificationHarness = new InboundVerificationHarness();
        outputHarness = new DisputeOutputStateHarness(stateMachine, address(utilityFacet));
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

    // ---- public computeDisputeOutputState (hits _calculateRemovals + exit shrink) ----
    // Participants include address(0) as a sentinel: _calculateRemovals allocates length 2 and
    // only shrinks when removalCount < 2. Without that shrink, trailing address(0) slots are
    // fed to removeParticipant and wrongly strip the sentinel — so these tests go red if the
    // shrink is dropped. (The both-removals case fills both slots, so shrink is a no-op there;
    // its mutation surface is the ordered exit list.)

    function test_computeDisputeOutputState_noRemoval_keepsAllParticipantsAndNoExits() public {
        address[] memory participants = _participantsWithZeroSentinel();
        DisputeInput memory input;
        input.channelId = CHANNEL_ID;
        input.forkId = FORK_ID;
        input.disputer = participants[0];
        // no selfRemoval, no timeout, no onChainSlashes

        (DisputeOutputState memory out, MathState memory result) = _computeDisputeOutputState(participants, input);

        assertEq(result.participants.length, 4);
        assertEq(result.participants[0], participants[0]);
        assertEq(result.participants[1], participants[1]);
        assertEq(result.participants[2], participants[2]);
        assertEq(result.participants[3], address(0));
        assertEq(out.outboundMessageBlock.messages.length, 0);
    }

    function test_computeDisputeOutputState_selfRemovalOnly_removesDisputerAndEmitsExit() public {
        address[] memory participants = _participantsWithZeroSentinel();
        DisputeInput memory input;
        input.channelId = CHANNEL_ID;
        input.forkId = FORK_ID;
        input.disputer = participants[0];
        input.selfRemoval = true;

        (DisputeOutputState memory out, MathState memory result) = _computeDisputeOutputState(participants, input);

        assertEq(result.participants.length, 3);
        assertEq(result.participants[0], participants[1]);
        assertEq(result.participants[1], participants[2]);
        assertEq(result.participants[2], address(0));
        _assertExactExitMessages(out, _oneAddress(participants[0]), _oneAmount(10));
    }

    function test_computeDisputeOutputState_timeoutOnly_removesTimedOutParticipantAndEmitsExit() public {
        address[] memory participants = _participantsWithZeroSentinel();
        DisputeInput memory input;
        input.channelId = CHANNEL_ID;
        input.forkId = FORK_ID;
        input.disputer = participants[0];
        input.timeout.participant = participants[2];

        (DisputeOutputState memory out, MathState memory result) = _computeDisputeOutputState(participants, input);

        assertEq(result.participants.length, 3);
        assertEq(result.participants[0], participants[0]);
        assertEq(result.participants[1], participants[1]);
        assertEq(result.participants[2], address(0));
        _assertExactExitMessages(out, _oneAddress(participants[2]), _oneAmount(30));
    }

    function test_computeDisputeOutputState_selfRemovalAndTimeout_removesBothInOrderAndEmitsExits() public {
        address[] memory participants = _participantsWithZeroSentinel();
        DisputeInput memory input;
        input.channelId = CHANNEL_ID;
        input.forkId = FORK_ID;
        input.disputer = participants[0];
        input.selfRemoval = true;
        input.timeout.participant = participants[1];

        (DisputeOutputState memory out, MathState memory result) = _computeDisputeOutputState(participants, input);

        // _calculateRemovals order: selfRemoval first, then timeout (fills both slots)
        assertEq(result.participants.length, 2);
        assertEq(result.participants[0], participants[2]);
        assertEq(result.participants[1], address(0));
        address[] memory expectedExits = new address[](2);
        expectedExits[0] = participants[0];
        expectedExits[1] = participants[1];
        uint256[] memory expectedAmounts = new uint256[](2);
        expectedAmounts[0] = 10;
        expectedAmounts[1] = 20;
        _assertExactExitMessages(out, expectedExits, expectedAmounts);
    }

    function test_computeDisputeOutputState_slashSuppressesTimeout_keepsTimeoutTargetAndExitsSlashOnly() public {
        address[] memory participants = _participantsWithZeroSentinel();
        DisputeInput memory input;
        input.channelId = CHANNEL_ID;
        input.forkId = FORK_ID;
        input.disputer = participants[0];
        input.onChainSlashes = _oneAddress(participants[0]);
        input.timeout.participant = participants[2];

        (DisputeOutputState memory out, MathState memory result) = _computeDisputeOutputState(participants, input);

        // onChainSlashes non-empty → timeout ignored by _calculateRemovals; only slash applies
        // removals empty after shrink — without shrink, trailing zeros would also strip the sentinel
        assertEq(result.participants.length, 3);
        assertEq(result.participants[0], participants[1]);
        assertEq(result.participants[1], participants[2]);
        assertEq(result.participants[2], address(0));
        _assertExactExitMessages(out, _oneAddress(participants[0]), _oneAmount(10));
    }

    // reduceOutput path (does not hit _calculateRemovals; keeps prior coverage of reduceOutputToSnapshotData)
    function test_reduceOutputToSnapshotData_timeoutOnly_removesTimedOutParticipant() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.timeout.participant = participants[2];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[0]);
        assertEq(output[1], participants[1]);
    }

    function test_reduceOutputToSnapshotData_slashOnly_removesSlashedParticipant() public {
        address[] memory participants = _participants();
        ReduceOutput memory reducedOutput;
        reducedOutput.slashedParticipants = new address[](1);
        reducedOutput.slashedParticipants[0] = participants[0];

        address[] memory output = _outputParticipants(reducedOutput, participants);

        assertEq(output.length, 2);
        assertEq(output[0], participants[1]);
        assertEq(output[1], participants[2]);
    }

    function test_reduceOutputToSnapshotData_slashAndTimeout_ignoresTimeout() public {
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

    function test_reduceOutputToSnapshotData_slashTimeoutAndSelfRemoval_ignoresTimeout() public {
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

    // ---- getOnChainSlashedParticipantsUpToTimestamp (hits _shrinkAddressArray) ----

    function test_getOnChainSlashedParticipantsUpToTimestamp_returnsStrictPrefixByCutoff() public {
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        address first = address(0xB1);
        address second = address(0xB2);

        // known timestamps so cutoffs are unambiguous
        uint256 t1 = 1000;
        uint256 t2 = 2000;

        vm.warp(t1);
        Dispute memory d1 = _structurallyInvalidDispute(keccak256("slash-cutoff-1"), first);
        harness.seedDispute(d1, t1);
        harness.killDispute(d1);

        vm.warp(t2);
        Dispute memory d2 = _structurallyInvalidDispute(keccak256("slash-cutoff-2"), second);
        harness.seedDispute(d2, t2);
        harness.killDispute(d2);

        // (a) cutoff before any slash -> empty
        address[] memory beforeAny = harness.getOnChainSlashedParticipantsUpToTimestamp(CHANNEL_ID, t1 - 1);
        assertEq(beforeAny.length, 0);

        // (b) cutoff between slashes -> strict prefix of first only
        address[] memory between = harness.getOnChainSlashedParticipantsUpToTimestamp(CHANNEL_ID, t1);
        assertEq(between.length, 1);
        assertEq(between[0], first);

        address[] memory stillBetween = harness.getOnChainSlashedParticipantsUpToTimestamp(CHANNEL_ID, t2 - 1);
        assertEq(stillBetween.length, 1);
        assertEq(stillBetween[0], first);

        // (c) cutoff after all -> every slash, order preserved
        address[] memory afterAll = harness.getOnChainSlashedParticipantsUpToTimestamp(CHANNEL_ID, t2);
        assertEq(afterAll.length, 2);
        assertEq(afterAll[0], first);
        assertEq(afterAll[1], second);
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
        // the error now carries (windowCreationTimestamp, minTimestamp); this case
        // pins the identity only -- the argument values are asserted end to end.
        vm.expectPartialRevert(RaceConditionDisputeTimeoutWindowCreatedTooEarly.selector);
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
        return
            diamond.getEvidenceTime() + diamond.getP2pTime() + diamond.getAgreementTime()
                + diamond.getChainFallbackTime();
    }

    function test_validateTimeoutCalldataPostedProof_firstBlockGraceEdge_valid() public {
        require(diamond.getEvidenceTime() > 0, "evidenceTime is 0 - grace not observable");
        (Dispute memory dispute, TimeoutCalldataPosted memory proof) =
            _timeoutCalldataPostedProofPostedAfter(_firstBlockGraceWindow());
        assertTrue(diamond.validateTimeoutCalldataPostedProof(proof, dispute), "first-block grace edge rejected");
    }

    function test_validateTimeoutCalldataPostedProof_pastFirstBlockGrace_invalid() public {
        require(diamond.getEvidenceTime() > 0, "evidenceTime is 0 - grace not observable");
        (Dispute memory dispute, TimeoutCalldataPosted memory proof) =
            _timeoutCalldataPostedProofPostedAfter(_firstBlockGraceWindow() + 1);
        assertFalse(
            diamond.validateTimeoutCalldataPostedProof(proof, dispute), "calldata posted past the grace window accepted"
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

    function test_disputeBlockAuthorNotParticipant_authorInStaleResultingSnapshot_valid() public {
        // The author is in the block's declared resulting snapshot, but that
        // snapshot's coordinates do not match the block (a departed member
        // naming a stale snapshot). The coordinate binding must not count it, so
        // the author is not a participant and the proof is valid - matching the
        // off-chain author gate so an honest auditor is never slashed.
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        (Dispute memory dispute, DisputeBlockAuthorNotParticipant memory proof, address signer) =
            _disputeBlockAuthorNotParticipantProof();

        proof.resultingStateSnapshot.snapshotData.participants[0] = signer;
        // stale: the resulting snapshot belongs to a later height, not this block
        proof.resultingStateSnapshot.blockHeight = 5;
        Block memory invalidBlock = abi.decode(dispute.input.stateProof.signedBlocks[0].encodedBlock, (Block));
        invalidBlock.stateSnapshotHash = keccak256(abi.encode(proof.resultingStateSnapshot));
        dispute.input.stateProof.signedBlocks[0].encodedBlock = abi.encode(invalidBlock);
        dispute.input.stateProof.signedBlocks[0].signature = _sign(1, abi.encode(invalidBlock));

        assertEq(harness.handleBlockAuthorNotParticipant(abi.encode(proof), dispute), dispute.input.disputer);
    }

    function test_disputeBlockAuthorNotParticipant_authorInWrongForkResultingSnapshot_valid() public {
        // The author is in the block's declared resulting snapshot, and the
        // height matches, but the snapshot's forkId does not (a departed
        // member naming a stale snapshot from a different fork at the same
        // height). The coordinate binding must not count it, so the author is
        // not a participant and the proof is valid - matching the off-chain
        // author gate so an honest auditor is never slashed.
        DisputeExpiryGuardHarness harness = new DisputeExpiryGuardHarness();
        (Dispute memory dispute, DisputeBlockAuthorNotParticipant memory proof, address signer) =
            _disputeBlockAuthorNotParticipantProof();

        proof.resultingStateSnapshot.snapshotData.participants[0] = signer;
        // stale: the resulting snapshot belongs to a different fork, not this block's
        proof.resultingStateSnapshot.forkId = keccak256("other-fork");
        Block memory invalidBlock = abi.decode(dispute.input.stateProof.signedBlocks[0].encodedBlock, (Block));
        invalidBlock.stateSnapshotHash = keccak256(abi.encode(proof.resultingStateSnapshot));
        dispute.input.stateProof.signedBlocks[0].encodedBlock = abi.encode(invalidBlock);
        dispute.input.stateProof.signedBlocks[0].signature = _sign(1, abi.encode(invalidBlock));

        assertEq(harness.handleBlockAuthorNotParticipant(abi.encode(proof), dispute), dispute.input.disputer);
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
        // the resulting snapshot is this block's own -> coordinate-bound
        resultingSnapshot.forkId = FORK_ID;
        resultingSnapshot.blockHeight = 0;

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

    /// Three real members + address(0) sentinel. Trailing zero slots from an unshrunk
    /// _calculateRemovals array would remove the sentinel and break length/order asserts.
    function _participantsWithZeroSentinel() internal pure returns (address[] memory participants) {
        participants = new address[](4);
        participants[0] = address(0xA1);
        participants[1] = address(0xA2);
        participants[2] = address(0xA3);
        participants[3] = address(0);
    }

    /// Fixed non-zero balances so exit amounts pin which participant was removed.
    /// Index matches _participantsWithZeroSentinel (sentinel gets amount 40).
    function _participantBalances(uint256 length) internal pure returns (uint256[] memory balances) {
        balances = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            balances[i] = 10 * (i + 1);
        }
    }

    function _oneAddress(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function _oneAmount(uint256 amount) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = amount;
    }

    function _computeDisputeOutputState(address[] memory participants, DisputeInput memory input)
        internal
        returns (DisputeOutputState memory out, MathState memory result)
    {
        MathState memory state;
        state.participants = participants;
        state.balances = _participantBalances(participants.length);
        bytes memory encodedState = abi.encode(state);

        StateSnapshot memory snapshot;
        snapshot.forkId = FORK_ID;
        snapshot.snapshotData.stateMachineStateHash = keccak256(encodedState);
        snapshot.snapshotData.participants = participants;

        MessageBlock[] memory inboundMessageBlocks = new MessageBlock[](0);
        out = outputHarness.computeDisputeOutputState(input, snapshot, encodedState, inboundMessageBlocks);
        result = abi.decode(out.encodedModifiedState, (MathState));
    }

    function _assertExactExitMessages(
        DisputeOutputState memory out,
        address[] memory expectedParticipants,
        uint256[] memory expectedAmounts
    ) internal pure {
        Message[] memory messages = out.outboundMessageBlock.messages;
        assertEq(messages.length, expectedParticipants.length);
        for (uint256 i = 0; i < expectedParticipants.length; i++) {
            assertEq(messages[i].messageType, MESSAGE_TYPE_EXIT);
            assertEq(messages[i].participant, expectedParticipants[i]);
            assertEq(messages[i].balance.amount, expectedAmounts[i]);
        }
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

    // ---- inbound message block walk ----

    function test_verifyInboundMessageBlocks_linkedChainMatchingTarget_isValid() public {
        MessageBlock[] memory blocks = _linkedInboundBlocks(SNAPSHOT_HEAD, 3, 0);
        bytes32 target = _chainHead(blocks);

        (bool isValid,,,) = verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, target, blocks);

        assertTrue(isValid);
    }

    function test_verifyInboundMessageBlocks_firstBlockNotChainedToSnapshotHead_reportsHashLinkAtZero() public {
        MessageBlock[] memory blocks = _linkedInboundBlocks(SNAPSHOT_HEAD, 2, 0);
        blocks[0].previousBlockHash = keccak256("not the snapshot head");

        (bool isValid, bytes32 runningHash, uint256 breakIndex, uint8 reason) =
            verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, _chainHead(blocks), blocks);

        assertFalse(isValid);
        assertEq(breakIndex, 0);
        assertEq(runningHash, SNAPSHOT_HEAD);
        assertEq(reason, INBOUND_FAILURE_HASH_LINK);
    }

    function test_verifyInboundMessageBlocks_midChainLinkBroken_reportsHashLinkAtBreakIndex() public {
        MessageBlock[] memory blocks = _linkedInboundBlocks(SNAPSHOT_HEAD, 3, 0);
        bytes32 headBeforeBreak = keccak256(abi.encode(blocks[0]));
        blocks[1].previousBlockHash = keccak256("wrong link");

        (bool isValid, bytes32 runningHash, uint256 breakIndex, uint8 reason) =
            verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, _chainHead(blocks), blocks);

        assertFalse(isValid);
        assertEq(breakIndex, 1);
        assertEq(runningHash, headBeforeBreak);
        assertEq(reason, INBOUND_FAILURE_HASH_LINK);
    }

    // the case the reason code exists for: hashes chain correctly, so a report
    // without a reason looks like a consistent chain that broke for no visible
    // cause. Only the height sequence is wrong.
    function test_verifyInboundMessageBlocks_skippedHeight_reportsHeightSequenceWithIntactHashLink() public {
        MessageBlock[] memory blocks = _linkedInboundBlocks(SNAPSHOT_HEAD, 3, 0);
        bytes32 headBeforeBreak = keccak256(abi.encode(blocks[0]));
        blocks[1].blockHeight = blocks[0].blockHeight + 2;

        (bool isValid, bytes32 runningHash, uint256 breakIndex, uint8 reason) =
            verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, _chainHead(blocks), blocks);

        assertFalse(isValid);
        assertEq(breakIndex, 1);
        assertEq(reason, INBOUND_FAILURE_HEIGHT_SEQUENCE);
        // the hash link at the break is intact - this is exactly what a bare
        // (runningHash, breakIndex) report could not distinguish
        assertEq(runningHash, headBeforeBreak);
        assertEq(runningHash, blocks[1].previousBlockHash);
    }

    function test_verifyInboundMessageBlocks_allLinkedButWrongTarget_reportsFinalTargetAtBlockCount() public {
        MessageBlock[] memory blocks = _linkedInboundBlocks(SNAPSHOT_HEAD, 3, 0);
        bytes32 computedHead = _chainHead(blocks);

        (bool isValid, bytes32 runningHash, uint256 breakIndex, uint8 reason) =
            verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, keccak256("some other target"), blocks);

        assertFalse(isValid);
        assertEq(breakIndex, blocks.length);
        assertEq(runningHash, computedHead);
        assertEq(reason, INBOUND_FAILURE_FINAL_TARGET);
    }

    function test_verifyInboundMessageBlocks_noBlocks_comparesSnapshotHeadAgainstTarget() public {
        MessageBlock[] memory blocks = new MessageBlock[](0);

        (bool matching,, uint256 matchingBreakIndex, uint8 matchingReason) =
            verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, SNAPSHOT_HEAD, blocks);
        (bool mismatched, bytes32 runningHash,, uint8 mismatchedReason) =
            verificationHarness.verifyInboundMessageBlocks(SNAPSHOT_HEAD, keccak256("other"), blocks);

        assertTrue(matching);
        assertEq(matchingBreakIndex, blocks.length);
        assertEq(matchingReason, INBOUND_FAILURE_FINAL_TARGET);
        assertFalse(mismatched);
        assertEq(runningHash, SNAPSHOT_HEAD);
        assertEq(mismatchedReason, INBOUND_FAILURE_FINAL_TARGET);
    }

    // proves the walk's report actually reaches the revert payload callers decode
    function test_reduceOutputToSnapshotData_unlinkedInboundBlocks_revertsCarryingComparedHashes() public {
        MathState memory state;
        state.participants = _participants();
        state.balances = new uint256[](state.participants.length);
        bytes memory encodedState = abi.encode(state);

        StateSnapshot memory snapshot;
        snapshot.snapshotData.stateMachineStateHash = keccak256(encodedState);
        snapshot.snapshotData.latestInboundMessageBlockHash = SNAPSHOT_HEAD;

        MessageBlock[] memory blocks = _linkedInboundBlocks(SNAPSHOT_HEAD, 2, 0);
        blocks[0].previousBlockHash = keccak256("not the snapshot head");

        ReduceOutput memory reducedOutput;
        reducedOutput.latestInboundMessageBlockHash = keccak256("target");

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorDisputeInboundMessageBlocksInvalid.selector,
                SNAPSHOT_HEAD,
                reducedOutput.latestInboundMessageBlockHash,
                SNAPSHOT_HEAD,
                uint256(0),
                uint256(blocks.length),
                INBOUND_FAILURE_HASH_LINK
            )
        );
        diamond.reduceOutputToSnapshotData(
            keccak256(abi.encode(snapshot.snapshotData)), reducedOutput, snapshot, encodedState, blocks
        );
    }

    /// `count` blocks each chained to the previous, heights ascending from
    /// `firstHeight`, the first anchored to `startHash`.
    function _linkedInboundBlocks(bytes32 startHash, uint256 count, uint256 firstHeight)
        internal
        pure
        returns (MessageBlock[] memory blocks)
    {
        blocks = new MessageBlock[](count);
        bytes32 runningHash = startHash;
        for (uint256 i = 0; i < count; i++) {
            blocks[i].previousBlockHash = runningHash;
            blocks[i].blockHeight = firstHeight + i;
            blocks[i].timestamp = 1000 + i;
            runningHash = keccak256(abi.encode(blocks[i]));
        }
    }

    function _chainHead(MessageBlock[] memory blocks) internal pure returns (bytes32 head) {
        head = blocks.length == 0 ? bytes32(0) : keccak256(abi.encode(blocks[blocks.length - 1]));
    }
}
