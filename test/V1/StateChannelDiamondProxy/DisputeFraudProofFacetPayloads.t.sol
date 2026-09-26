pragma solidity ^0.8.8;

import {DiamondHarness} from "../harness/DiamondHarness.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {DisputeFraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/DisputeFraudProofFacet.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import {
    RaceConditionDisputeEvidencePeriodExpired,
    RaceConditionGenesisTimestampNotAvailable,
    RaceConditionUnexpectedBlockCalldataPosted
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {TimeoutCalldataPosted, TimeoutTooEarly} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
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
        dispute.input.stateProof.signedBlocks = new SignedBlock[](1);
        dispute.input.stateProof.signedBlocks[0].encodedBlock =
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
        dispute.input.stateProof.signedBlocks = new SignedBlock[](1);
        dispute.input.stateProof.signedBlocks[0] = previousBlock;

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
