pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateProofHarness, StateProofStaging} from "../harness/StateProofStaging.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {
    RaceConditionDisputeEvidencePeriodExpired,
    RaceConditionDisputeKillPeriodExpired,
    RaceConditionGenesisTimestampNotAvailable,
    RaceConditionOnChainSlashes,
    RaceConditionUnexpectedBlockCalldataPosted
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {
    DisputeInboundHashNotInChain,
    DisputeInvalidOutputState,
    DisputeInvalidStateProof,
    DisputeLastMilestoneNotFinalAndNoAuditingData,
    DisputeNotLatestState,
    DisputeOnChainSlashesNotSubset,
    DisputeStateProofBelowOnChainAnchor,
    InvalidDisputeReason,
    TimeoutCalldataPosted,
    TimeoutNotLinkedToLatestState,
    TimeoutParticipantNotNext,
    TimeoutThreshold,
    TimeoutTooEarly
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/DataTypes.sol";

/// Exposes the facet's internal `_handleTimeoutTooEarly` so its two race-condition
/// guards can be driven directly - the production body still runs, the harness only
/// reaches it and seeds the one storage slot the guard reads. `UtilityFacet` is
/// inherited because the handler resolves the dispute window's creation timestamp
/// through a self-call on the diamond's external surface, which a bare
/// `DisputeFraudProofFacet` deployment does not answer.
contract TimeoutTooEarlyPayloadHarness is DisputeFraudProofFacet, UtilityFacet {
    constructor() {
        // the harness already carries the utility facet's code, so the stateless
        // helpers `StateChannelCommon` calls externally resolve on itself
        utilityFacetAddress = address(this);
    }

    function seedBlockCalldataCommitment(
        bytes32 channelId,
        address participant,
        bytes32 forkId,
        uint256 blockHeight,
        bytes32 commitment
    ) external {
        blockCalldataCommitments[channelId][participant][forkId][blockHeight] = commitment;
    }

    function handleTimeoutTooEarly(bytes memory encodedProof, Dispute memory dispute) external view returns (address) {
        return _handleTimeoutTooEarly(encodedProof, dispute);
    }
}

// test naming: test_<targetFunction>_<property>
contract DisputeFraudProofFacetPayloadsTest is DiamondHarness {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant TIMED_OUT_PK = 0xDEFA17;
    uint256 internal constant PREVIOUS_AUTHOR_PK = 0xC0FFEE;

    bytes32 internal constant EVIDENCE_CHANNEL_ID = keccak256("evidence-period-channel");
    bytes32 internal constant TIMEOUT_CHANNEL_ID = keccak256("timeout-too-early-channel");
    bytes32 internal constant CALLDATA_CHANNEL_ID = keccak256("timeout-calldata-channel");
    bytes32 internal constant ORIGIN_FORK_ID = keccak256("origin-fork");
    bytes32 internal constant TIMEOUT_FORK_ID = keccak256("timeout-too-early-fork");
    bytes32 internal constant CALLDATA_FORK_ID = keccak256("timeout-calldata-fork");
    bytes32 internal constant PREVIOUS_BLOCK_COMMITMENT = keccak256("previous-block-calldata-commitment");

    address internal constant TIMED_OUT_PARTICIPANT = address(0x7157);
    address internal constant PREVIOUS_BLOCK_AUTHOR = address(0xB10C);

    uint256 internal constant PREVIOUS_BLOCK_HEIGHT = 8;
    uint256 internal constant POSTED_BLOCK_HEIGHT = 9;

    /// Absolute timestamps, so every expected operand is a test-owned value rather
    /// than a local copy of `block.timestamp` read back after a `vm.warp`.
    uint256 internal constant FIRST_UPLOAD_TIMESTAMP = 1_000;
    uint256 internal constant EVIDENCE_OVERSHOOT = 7;
    uint256 internal constant PREVIOUS_BLOCK_TIMESTAMP = 2_000;
    uint256 internal constant POSTED_BLOCK_TIMESTAMP = 2_100;
    uint256 internal constant PREVIOUS_POST_TIMESTAMP = 2_200;
    uint256 internal constant POSTED_POST_TIMESTAMP = 2_300;

    function setUp() public {
        diamond = deployDiamond();
        _openChannel(EVIDENCE_CHANNEL_ID, _privateKeys());
    }

    // ---- uploadDispute: the evidence deadline of an already populated window ----

    // A second disputer arriving after the window's evidence period closed must be
    // told when that period ended and when it is now - two different values, so a
    // deadline computed from the wrong base or reported in the wrong slot fails.
    function test_uploadDispute_evidencePeriodExpired_revertsCarryingPeriodEndAndCurrentTimestamp() public {
        bytes32 forkId = diamond.getStateSnapshot(EVIDENCE_CHANNEL_ID).forkId;
        uint256 evidenceTime = diamond.getEvidenceTime();

        vm.warp(FIRST_UPLOAD_TIMESTAMP);
        DisputeConfirmation memory aliceConfirmation = _disputeConfirmation(EVIDENCE_CHANNEL_ID, forkId, ALICE_PK);
        vm.prank(vm.addr(ALICE_PK));
        diamond.uploadDispute(aliceConfirmation);

        // the window opened at the first upload, so its evidence period ends one
        // evidence time later; land strictly past it
        uint256 evidencePeriodEnd = FIRST_UPLOAD_TIMESTAMP + evidenceTime;
        uint256 lateTimestamp = evidencePeriodEnd + EVIDENCE_OVERSHOOT;
        vm.warp(lateTimestamp);

        DisputeConfirmation memory bobConfirmation = _disputeConfirmation(EVIDENCE_CHANNEL_ID, forkId, BOB_PK);
        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionDisputeEvidencePeriodExpired.selector, evidencePeriodEnd, lateTimestamp)
        );
        vm.prank(vm.addr(BOB_PK));
        diamond.uploadDispute(bobConfirmation);
    }

    // ---- _handleTimeoutTooEarly: the genesis branch ----

    // A timeout proof whose fork starts at genesis needs the chain to date that
    // genesis; with no dispute window on the origin fork and no matching on-chain
    // snapshot it cannot, and the revert must name all three identifying hashes.
    function test_handleTimeoutTooEarly_genesisTimestampUnavailable_revertsCarryingChannelOriginAndTargetForks()
        public
    {
        TimeoutTooEarlyPayloadHarness harness = new TimeoutTooEarlyPayloadHarness();

        TimeoutTooEarly memory proof;
        proof.genesisStateSnapshotData.originForkId = ORIGIN_FORK_ID;
        // the fork the proof claims is by definition the hash of its genesis data
        bytes32 forkId = keccak256(abi.encode(proof.genesisStateSnapshotData));
        // the three reported hashes must be distinguishable, or a swapped payload
        // would still satisfy the oracle below
        assertTrue(forkId != ORIGIN_FORK_ID);
        assertTrue(forkId != TIMEOUT_CHANNEL_ID);
        assertTrue(ORIGIN_FORK_ID != TIMEOUT_CHANNEL_ID);

        Dispute memory dispute;
        dispute.input.channelId = TIMEOUT_CHANNEL_ID;
        dispute.input.forkId = forkId;
        dispute.input.timeout.participant = TIMED_OUT_PARTICIPANT;
        // an empty state proof holds no block, so the handler takes the genesis branch

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionGenesisTimestampNotAvailable.selector, TIMEOUT_CHANNEL_ID, ORIGIN_FORK_ID, forkId
            )
        );
        harness.handleTimeoutTooEarly(abi.encode(proof), dispute);
    }

    // ---- _handleTimeoutTooEarly: the previous-block calldata branch ----

    // The previous block's author did post its calldata on chain, so a proof that
    // claims no on-chain timestamp for it is stale; the revert must hand back the
    // full identity of the commitment the prover missed.
    function test_handleTimeoutTooEarly_previousBlockCalldataPosted_revertsCarryingForkHeightAuthorAndCommitment()
        public
    {
        TimeoutTooEarlyPayloadHarness harness = new TimeoutTooEarlyPayloadHarness();
        harness.seedBlockCalldataCommitment(
            TIMEOUT_CHANNEL_ID, PREVIOUS_BLOCK_AUTHOR, TIMEOUT_FORK_ID, PREVIOUS_BLOCK_HEIGHT, PREVIOUS_BLOCK_COMMITMENT
        );

        Dispute memory dispute;
        dispute.input.channelId = TIMEOUT_CHANNEL_ID;
        dispute.input.forkId = TIMEOUT_FORK_ID;
        dispute.input.timeout.participant = TIMED_OUT_PARTICIPANT;
        dispute.input.timeout.blockHeight = POSTED_BLOCK_HEIGHT;
        dispute.input.stateProof.milestones = new MilestoneProof[](1);
        dispute.input.stateProof.milestones[0].blockConfirmations = new BlockConfirmation[](1);
        dispute.input.stateProof.milestones[0].blockConfirmations[0].signedBlock.encodedBlock =
            abi.encode(_block(PREVIOUS_BLOCK_AUTHOR, TIMEOUT_CHANNEL_ID, TIMEOUT_FORK_ID, PREVIOUS_BLOCK_HEIGHT));

        // the timed-out participant, the previous author and the two hashes must
        // all be distinguishable, or a swapped payload would still pass
        assertTrue(PREVIOUS_BLOCK_AUTHOR != TIMED_OUT_PARTICIPANT);
        assertTrue(PREVIOUS_BLOCK_COMMITMENT != TIMEOUT_FORK_ID);

        // `previousBlockOnChainTimestamp` left at zero: the proof denies the posting
        TimeoutTooEarly memory proof;

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionUnexpectedBlockCalldataPosted.selector,
                TIMEOUT_FORK_ID,
                PREVIOUS_BLOCK_HEIGHT,
                PREVIOUS_BLOCK_AUTHOR,
                PREVIOUS_BLOCK_COMMITMENT
            )
        );
        harness.handleTimeoutTooEarly(abi.encode(proof), dispute);
    }

    // ---- validateTimeoutCalldataPostedProof: the genesis branch ----

    // Same undatable genesis, reached through the second timeout-proof pipeline:
    // the posted block's calldata is genuinely on chain, the state proof holds no
    // block, and nothing dates the fork's genesis.
    function test_validateTimeoutCalldataPostedProof_genesisTimestampUnavailable_revertsCarryingChannelOriginAndTargetForks(
    ) public {
        TimeoutCalldataPosted memory proof;
        proof.genesisStateSnapshotData.originForkId = ORIGIN_FORK_ID;
        bytes32 forkId = keccak256(abi.encode(proof.genesisStateSnapshotData));
        assertTrue(forkId != ORIGIN_FORK_ID);
        assertTrue(forkId != CALLDATA_CHANNEL_ID);
        assertTrue(ORIGIN_FORK_ID != CALLDATA_CHANNEL_ID);

        SignedBlock memory postedBlock = _makeSignedBlock(
            TIMED_OUT_PK, CALLDATA_CHANNEL_ID, forkId, POSTED_BLOCK_HEIGHT, POSTED_BLOCK_TIMESTAMP, bytes32(0)
        );
        vm.warp(POSTED_POST_TIMESTAMP);
        vm.prank(vm.addr(TIMED_OUT_PK));
        diamond.postBlockCalldata(postedBlock, POSTED_POST_TIMESTAMP);

        proof.postedBlock = postedBlock;
        proof.onChainTimestamp = POSTED_POST_TIMESTAMP;

        Dispute memory dispute;
        dispute.input.channelId = CALLDATA_CHANNEL_ID;
        dispute.input.forkId = forkId;
        dispute.input.timeout.participant = vm.addr(TIMED_OUT_PK);
        dispute.input.timeout.blockHeight = POSTED_BLOCK_HEIGHT;

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionGenesisTimestampNotAvailable.selector, CALLDATA_CHANNEL_ID, ORIGIN_FORK_ID, forkId
            )
        );
        diamond.validateTimeoutCalldataPostedProof(proof, dispute);
    }

    // ---- validateTimeoutCalldataPostedProof: the previous-block calldata branch ----

    // Both blocks' calldata is on chain. The proof supplies the timestamp for the
    // timed-out block but denies one for the previous block, so the pipeline must
    // report the previous block's own fork, height, author and stored commitment -
    // never the timed-out block's, which differ in every position.
    function test_validateTimeoutCalldataPostedProof_previousBlockCalldataPosted_revertsCarryingForkHeightAuthorAndCommitment(
    ) public {
        address timedOut = vm.addr(TIMED_OUT_PK);
        address previousAuthor = vm.addr(PREVIOUS_AUTHOR_PK);
        assertTrue(timedOut != previousAuthor);

        SignedBlock memory previousBlock = _makeSignedBlock(
            PREVIOUS_AUTHOR_PK,
            CALLDATA_CHANNEL_ID,
            CALLDATA_FORK_ID,
            PREVIOUS_BLOCK_HEIGHT,
            PREVIOUS_BLOCK_TIMESTAMP,
            bytes32(0)
        );
        SignedBlock memory postedBlock = _makeSignedBlock(
            TIMED_OUT_PK, CALLDATA_CHANNEL_ID, CALLDATA_FORK_ID, POSTED_BLOCK_HEIGHT, POSTED_BLOCK_TIMESTAMP, bytes32(0)
        );

        vm.warp(PREVIOUS_POST_TIMESTAMP);
        vm.prank(previousAuthor);
        diamond.postBlockCalldata(previousBlock, PREVIOUS_POST_TIMESTAMP);

        vm.warp(POSTED_POST_TIMESTAMP);
        vm.prank(timedOut);
        diamond.postBlockCalldata(postedBlock, POSTED_POST_TIMESTAMP);

        // the commitment the chain stored for the previous block, rebuilt from the
        // block and the timestamp this test posted it at
        bytes32 previousBlockCommitment = keccak256(abi.encode(previousBlock, PREVIOUS_POST_TIMESTAMP));
        assertTrue(previousBlockCommitment != CALLDATA_FORK_ID);
        assertTrue(previousBlockCommitment != keccak256(abi.encode(postedBlock, POSTED_POST_TIMESTAMP)));

        TimeoutCalldataPosted memory proof;
        proof.postedBlock = postedBlock;
        proof.onChainTimestamp = POSTED_POST_TIMESTAMP;
        // `previousBlockOnChainTimestamp` left at zero: the proof denies the posting

        Dispute memory dispute;
        dispute.input.channelId = CALLDATA_CHANNEL_ID;
        dispute.input.forkId = CALLDATA_FORK_ID;
        dispute.input.timeout.participant = timedOut;
        dispute.input.timeout.blockHeight = POSTED_BLOCK_HEIGHT;
        dispute.input.stateProof.milestones = new MilestoneProof[](1);
        dispute.input.stateProof.milestones[0].blockConfirmations = new BlockConfirmation[](1);
        dispute.input.stateProof.milestones[0].blockConfirmations[0].signedBlock = previousBlock;

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionUnexpectedBlockCalldataPosted.selector,
                CALLDATA_FORK_ID,
                PREVIOUS_BLOCK_HEIGHT,
                previousAuthor,
                previousBlockCommitment
            )
        );
        diamond.validateTimeoutCalldataPostedProof(proof, dispute);
    }

    /// A dispute the channel's own participant signs, with no timeout and no
    /// existing-window requirement, so admission turns only on the window state.
    function _disputeConfirmation(bytes32 channelId, bytes32 forkId, uint256 pk)
        internal
        view
        returns (DisputeConfirmation memory confirmation)
    {
        StateSnapshot memory snapshot = diamond.getStateSnapshot(channelId);
        Dispute memory dispute;
        dispute.input.channelId = channelId;
        dispute.input.forkId = forkId;
        dispute.input.disputer = vm.addr(pk);
        // anchored at the consumed inbound so the upload reaches the race checks
        dispute.input.latestInboundMessageBlockHash = snapshot.snapshotData.latestInboundMessageBlockHash;
        dispute.input.lastInboundMessageBlockHeight = snapshot.snapshotData.latestInboundMessageBlockHeight;

        confirmation.signedDispute.encodedDispute = abi.encode(dispute);
        confirmation.signedDispute.signature = _sign(pk, confirmation.signedDispute.encodedDispute);
        confirmation.signatures = new bytes[](0);
    }

    /// The minimal block the timeout handlers read: channel, fork, height, author.
    function _block(address author, bytes32 channelId, bytes32 forkId, uint256 blockHeight)
        internal
        pure
        returns (Block memory blockData)
    {
        blockData.transaction.header.channelId = channelId;
        blockData.transaction.header.participant = author;
        blockData.transaction.header.forkId = forkId;
        blockData.transaction.header.transactionCnt = blockHeight;
        blockData.transaction.header.timestamp = PREVIOUS_BLOCK_TIMESTAMP;
    }

    function _privateKeys() internal pure returns (uint256[] memory pks) {
        pks = new uint256[](2);
        pks[0] = ALICE_PK;
        pks[1] = BOB_PK;
    }
}

/// The dedicated counter to a latest claim below the current same-fork on-chain snapshot anchor: the chain reads the
/// anchor itself, needs no newer disputer-signed block, and treats an empty proof as the fork genesis.
// test naming: test_<canonical case in camel case>
contract DisputeStateProofBelowOnChainAnchorTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    function test_strictlyLowerSameForkClaimIsCountered() public {
        _seedAnchor(ANCHOR_HEIGHT);
        // a posted-data dispute whose latest block 3 is below the anchor; A never signed anything newer
        MilestoneProof memory run = _thresholdRun(1, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        (Dispute memory dispute,) = _dispute(_one(run), _entries(_snapshot(1, genesisData.participants)), true);
        _commit(dispute);
        _applyBelowAnchor(dispute);
        _assertKilled(dispute);
    }

    function test_equalHeightClaimIsNotCountered() public {
        _seedAnchor(ANCHOR_HEIGHT);
        (Dispute memory dispute,) =
            _dispute(_one(_run(3, 3, bytes32(0), _signers(ALICE_KEY))), new StateSnapshot[](0), false);
        _commit(dispute);
        _applyBelowAnchor(dispute);
        _assertRejected(dispute);
    }

    function test_higherSameForkClaimIsNotCountered() public {
        _seedAnchor(ANCHOR_HEIGHT);
        // the latest block 7 is above the anchor 5
        (Dispute memory dispute,) =
            _dispute(_one(_run(ANCHOR_HEIGHT, 3, bytes32(0), _signers(ALICE_KEY))), new StateSnapshot[](0), false);
        _commit(dispute);
        _applyBelowAnchor(dispute);
        _assertRejected(dispute);
    }

    function test_claimBelowAnOtherForkSnapshotIsNotCountered() public {
        // the on-chain snapshot at height 10 lies on another fork: it is no anchor for this fork
        StateSnapshot memory otherFork = _snapshot(10, genesisData.participants);
        otherFork.forkId = keccak256("other-fork");
        harness.seedSnapshot(CHANNEL, otherFork);
        (Dispute memory dispute,) =
            _dispute(_one(_run(1, 3, bytes32(0), _signers(ALICE_KEY))), new StateSnapshot[](0), false);
        _commit(dispute);
        _applyBelowAnchor(dispute);
        _assertRejected(dispute);
    }

    function test_emptyGenesisWithoutAdvanceIsLegitimate() public {
        // the chain snapshot is still this fork's genesis
        (Dispute memory dispute,) = _dispute(new MilestoneProof[](0), new StateSnapshot[](0), false);
        _commit(dispute);
        _applyBelowAnchor(dispute);
        _assertRejected(dispute);
    }

    function test_emptyGenesisWithNormalZeroAnchorIsCountered() public {
        // block 0 committed a normal snapshot at height 0: not the genesis, and the empty claim is behind it
        _seedAnchor(0);
        (Dispute memory dispute,) = _dispute(new MilestoneProof[](0), new StateSnapshot[](0), true);
        _commit(dispute);
        _applyBelowAnchor(dispute);
        _assertKilled(dispute);
    }

    function _applyBelowAnchor(Dispute memory dispute) private {
        _apply(
            dispute,
            DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor,
            abi.encode(DisputeStateProofBelowOnChainAnchor({__: false}))
        );
    }
}

/// `DisputeInvalidStateProof` over posted data binds the posted finalized state to the snapshot the walk ends at: a
/// dispute posting another state is killed, an allegation against the walk's own state slashes its submitter.
// test naming: test_<canonical case in camel case>
contract DisputeInvalidStateProofFinalizedStateTest is StateProofStaging {
    function setUp() public {
        _stageGenesisChannel();
    }

    function test_postedStateOfAnotherSnapshotIsKilled() public {
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _postedRun();
        // the state of the run's latest block, not of the threshold snapshot the walk ends at
        auditingData.latestFinalizedStateStateMachineState = _state(4, genesisData.participants);
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
        _commit(dispute);
        _applyInvalidStateProof(dispute, auditingData);
        _assertKilled(dispute);
    }

    function test_postedStateOfTheWalksFinalizedSnapshotIsNotCountered() public {
        (Dispute memory dispute, DisputeAuditingData memory auditingData) = _postedRun();
        _commit(dispute);
        _applyInvalidStateProof(dispute, auditingData);
        _assertRejected(dispute);
    }

    /// A's posted-data dispute over the threshold run [2, 3, 4]
    function _postedRun() private view returns (Dispute memory dispute, DisputeAuditingData memory auditingData) {
        MilestoneProof memory run = _thresholdRun(2, 3, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
        (dispute, auditingData) = _dispute(_one(run), _entries(_snapshot(2, genesisData.participants)), true);
        auditingData.latestStateSnapshot = _snapshot(4, genesisData.participants);
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
    }

    function _applyInvalidStateProof(Dispute memory dispute, DisputeAuditingData memory auditingData) private {
        _apply(
            dispute,
            DisputeFraudProofType.DisputeInvalidStateProof,
            abi.encode(DisputeInvalidStateProof({auditingData: auditingData}))
        );
    }
}

/// Each dispute fraud-proof family through `applyDisputeFraudProofs`: a valid allegation kills the dispute and slashes
/// the disputer, an invalid one leaves the dispute committed and slashes the submitter. The dispute is A's view
/// [3, 4] whose block 4 commits a real Math state (A's turn) at the fork genesis {A, B}; B submits every allegation.
// test naming: test_<canonical case in camel case>
contract DisputeFraudProofFamilyTest is StateProofStaging {
    /// the harness's evidence time: a kill period ends this long after the last evidence submission
    uint256 private constant HARNESS_EVIDENCE_TIME = 10;
    /// the time `_stageGenesisChannel` warps to, when every dispute here is committed
    uint256 private constant STAGING_TIMESTAMP = 1_000_000;
    uint256 private constant FAMILY_CASES = 16;

    function setUp() public {
        _stageGenesisChannel();
    }

    function test_eachFamilyKillsAValidAllegationAndPunishesAnInvalidOne() public {
        for (uint256 c = 0; c < FAMILY_CASES; c++) {
            harness = new StateProofHarness();
            harness.seedSnapshot(CHANNEL, genesis);
            (Dispute memory dispute, DisputeFraudProofType proofType, bytes memory encodedProof) = _familyCase(c);
            _commit(dispute);
            _apply(dispute, proofType, encodedProof);
            // even rows hold a valid allegation, odd rows its invalid counterpart
            if (c % 2 == 0) _assertKilled(dispute);
            else _assertRejected(dispute);
        }
    }

    function test_onChainSlashesNotSubsetKillsAnOverListingAndRevertsOnASubset() public {
        (Dispute memory dispute,,) = _base();
        // A lists C's slash, which the chain never recorded
        dispute.input.onChainSlashes = _set(carol);
        _commit(dispute);
        _apply(dispute, DisputeFraudProofType.DisputeOnChainSlashesNotSubset, _noSlashProof());
        _assertKilled(dispute);

        // a dispute listing no unrecorded slash is no over-listing: the allegation reverts as a race
        (dispute,,) = _base();
        _commit(dispute);
        vm.expectPartialRevert(RaceConditionOnChainSlashes.selector);
        _apply(dispute, DisputeFraudProofType.DisputeOnChainSlashesNotSubset, _noSlashProof());
    }

    function test_killAcceptedAtTheLastSecondOfTheKillPeriod() public {
        (Dispute memory dispute,,) = _base();
        // committed at the staging time; a local copy of `block.timestamp` is not safe across `vm.warp`
        _commit(dispute);
        (, bytes memory encodedProof) = _notLatestState(true);

        vm.warp(STAGING_TIMESTAMP + HARNESS_EVIDENCE_TIME);
        vm.expectPartialRevert(RaceConditionDisputeKillPeriodExpired.selector);
        _apply(dispute, DisputeFraudProofType.DisputeNotLatestState, encodedProof);

        vm.warp(STAGING_TIMESTAMP + HARNESS_EVIDENCE_TIME - 1);
        _apply(dispute, DisputeFraudProofType.DisputeNotLatestState, encodedProof);
        _assertKilled(dispute);
    }

    function test_alreadyKilledDisputeIsSkipped() public {
        (Dispute memory dispute,,) = _base();
        _commit(dispute);
        (, bytes memory encodedProof) = _notLatestState(true);
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](2);
        proofs[0] = DisputeFraudProof(DisputeFraudProofType.DisputeNotLatestState, alice, dispute, encodedProof);
        proofs[1] = proofs[0];
        // the second proof of the batch finds the dispute already killed
        vm.prank(bob);
        harness.applyDisputeFraudProofs(proofs);
        _assertKilled(dispute);

        // a later invalid allegation against the killed dispute is a no-op: the submitter is not punished
        (, bytes memory invalidProof) = _notLatestState(false);
        proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof(DisputeFraudProofType.DisputeNotLatestState, alice, dispute, invalidProof);
        vm.prank(bob);
        harness.applyDisputeFraudProofs(proofs);
        assertFalse(harness.isSlashed(CHANNEL, bob), "a skipped allegation costs nothing");
    }

    /// family case `c`: family `c / 2`, valid when `c` is even
    function _familyCase(uint256 c)
        private
        returns (Dispute memory dispute, DisputeFraudProofType proofType, bytes memory encodedProof)
    {
        bool valid = c % 2 == 0;
        uint256 family = c / 2;
        if (family == 0) {
            (dispute, encodedProof) = _notLatestState(valid);
            return (dispute, DisputeFraudProofType.DisputeNotLatestState, encodedProof);
        }
        if (family == 1) {
            (dispute, encodedProof) = _invalidOutputState(valid);
            return (dispute, DisputeFraudProofType.DisputeInvalidOutputState, encodedProof);
        }
        if (family == 2) {
            (dispute, encodedProof) = _timeoutThreshold(valid);
            return (dispute, DisputeFraudProofType.TimeoutThreshold, encodedProof);
        }
        if (family == 3) {
            (dispute, encodedProof) = _timeoutNotLinked(valid);
            return (dispute, DisputeFraudProofType.TimeoutNotLinkedToLatestState, encodedProof);
        }
        if (family == 4) {
            (dispute, encodedProof) = _timeoutParticipantNotNext(valid);
            return (dispute, DisputeFraudProofType.TimeoutParticipantNotNext, encodedProof);
        }
        if (family == 5) {
            (dispute, encodedProof) = _lastMilestoneNotFinal(valid);
            return (dispute, DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, encodedProof);
        }
        if (family == 6) {
            (dispute, encodedProof) = _invalidDisputeReason(valid);
            return (dispute, DisputeFraudProofType.InvalidDisputeReason, encodedProof);
        }
        (dispute, encodedProof) = _inboundHashNotInChain(valid);
        return (dispute, DisputeFraudProofType.DisputeInboundHashNotInChain, encodedProof);
    }

    // ---- the dispute ----

    /// A's dispute over [3, 4], block 4 committing `latest` whose Math state `state` gives A the next turn
    function _base() private view returns (Dispute memory dispute, StateSnapshot memory latest, bytes memory state) {
        (latest, state) = _balanceSnapshot(4, genesisData.participants, 0, 0);
        MilestoneProof memory run = _run(3, 2, keccak256("block 2"), _signers(ALICE_KEY));
        _commitAt(run, 1, keccak256(abi.encode(latest)), _signers(ALICE_KEY));
        (dispute,) = _dispute(_one(run), new StateSnapshot[](0), false);
    }

    /// the hash block 5 links to: the signed bytes of the dispute's latest block 4
    function _latestBlockHash(Dispute memory dispute) private pure returns (bytes32) {
        return keccak256(dispute.input.stateProof.milestones[0].blockConfirmations[1].signedBlock.encodedBlock);
    }

    // ---- one family each: the valid allegation and its invalid counterpart ----

    /// A signed a newer block 5; the invalid counterpart is A's block at the latest height 4
    function _notLatestState(bool valid) private view returns (Dispute memory dispute, bytes memory encodedProof) {
        (dispute,,) = _base();
        bytes memory encodedBlock = abi.encode(_block(valid ? 5 : 4, _latestBlockHash(dispute), _hashAt(5)));
        encodedProof = abi.encode(DisputeNotLatestState(encodedBlock, _sign(ALICE_KEY, encodedBlock)));
    }

    /// the committed output is not what the latest state yields; the invalid counterpart commits the real output
    function _invalidOutputState(bool valid) private returns (Dispute memory dispute, bytes memory encodedProof) {
        StateSnapshot memory latest;
        bytes memory state;
        (dispute, latest, state) = _base();
        // the latest state consumed the inbound head the dispute names
        dispute.input.latestInboundMessageBlockHash = BALANCE_INBOUND_HEAD;
        MessageBlock[] memory noInbound = new MessageBlock[](0);
        dispute.outputSnapshotDataHash = valid
            ? keccak256("not the output")
            : keccak256(abi.encode(harness.computeDisputeOutputSnapshotData(dispute.input, latest, state, noInbound)));
        encodedProof = abi.encode(DisputeInvalidOutputState(latest, state, noInbound));
    }

    /// B, blamed for block 5, authored a block 5 that A and B signed; the invalid counterpart carries only B's
    function _timeoutThreshold(bool valid) private view returns (Dispute memory dispute, bytes memory encodedProof) {
        StateSnapshot memory latest;
        (dispute, latest,) = _base();
        dispute.input.timeout.participant = bob;
        dispute.input.timeout.blockHeight = 5;
        Block memory five = _block(5, _latestBlockHash(dispute), _hashAt(5));
        five.transaction.header.participant = bob;
        BlockConfirmation memory confirmation =
            _blockConfirmation(abi.encode(five), valid ? _signers(BOB_KEY, ALICE_KEY) : _signers(BOB_KEY));
        encodedProof = abi.encode(TimeoutThreshold(confirmation, latest, _snapshot(5, genesisData.participants)));
    }

    /// the timeout names height 7, not the next height 5; the invalid counterpart names 5
    function _timeoutNotLinked(bool valid) private view returns (Dispute memory dispute, bytes memory encodedProof) {
        (dispute,,) = _base();
        dispute.input.timeout.participant = bob;
        dispute.input.timeout.blockHeight = valid ? 7 : 5;
        encodedProof = abi.encode(TimeoutNotLinkedToLatestState(false));
    }

    /// the timeout blames B while A holds the turn; the invalid counterpart blames A
    function _timeoutParticipantNotNext(bool valid)
        private
        view
        returns (Dispute memory dispute, bytes memory encodedProof)
    {
        StateSnapshot memory latest;
        bytes memory state;
        (dispute, latest, state) = _base();
        dispute.input.timeout.participant = valid ? bob : alice;
        dispute.input.timeout.blockHeight = 5;
        encodedProof = abi.encode(TimeoutParticipantNotNext(latest, state));
    }

    /// no posted data and a last milestone only A signed; the invalid counterpart's last milestone A and B signed
    function _lastMilestoneNotFinal(bool valid)
        private
        view
        returns (Dispute memory dispute, bytes memory encodedProof)
    {
        if (valid) {
            (dispute,,) = _base();
        } else {
            MilestoneProof memory run = _thresholdRun(3, 2, genesisData.participants, _signers(ALICE_KEY, BOB_KEY));
            (dispute,) = _dispute(_one(run), new StateSnapshot[](0), false);
        }
        encodedProof = abi.encode(DisputeLastMilestoneNotFinalAndNoAuditingData(false));
    }

    /// the dispute has no reason; the invalid counterpart asks for A's own removal
    function _invalidDisputeReason(bool valid)
        private
        view
        returns (Dispute memory dispute, bytes memory encodedProof)
    {
        StateSnapshot memory latest;
        (dispute, latest,) = _base();
        dispute.input.selfRemoval = !valid;
        encodedProof = abi.encode(InvalidDisputeReason(latest));
    }

    /// the dispute names an inbound head the chain never recorded; the invalid counterpart names none
    function _inboundHashNotInChain(bool valid)
        private
        view
        returns (Dispute memory dispute, bytes memory encodedProof)
    {
        (dispute,,) = _base();
        if (valid) dispute.input.latestInboundMessageBlockHash = keccak256("not in the inbound chain");
        encodedProof = abi.encode(DisputeInboundHashNotInChain(false));
    }

    function _noSlashProof() private pure returns (bytes memory) {
        return abi.encode(DisputeOnChainSlashesNotSubset(false));
    }
}
