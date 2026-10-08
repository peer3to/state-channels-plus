// SPDX-License-Identifier: UNLICENSED

import {DisputeWindowSeeding} from "../harness/DisputeWindowSeeding.sol";
import {TimeoutCalldataPostedStaging} from "../harness/TimeoutCalldataPostedStaging.sol";
import {FraudProofFacet} from "../../../contracts/V1/StateChannelDiamondProxy/FraudProofFacet.sol";
import {MathState, MathStateMachine} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    RaceConditionDisputeKillPeriodNotExpired,
    RaceConditionDisputeWindowNotOpen,
    RaceConditionGenesisTimestampNotAvailable
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {StateChannelManagerInterface} from "../../../contracts/V1/StateChannelManagerInterface.sol";
import {UtilityFacet} from "../../../contracts/V1/StateChannelDiamondProxy/UtilityFacet.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import {DisputeInvalidBlockInStateProofApplyFraudProof} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import "../../../contracts/V1/types/FraudProofTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// Runs the fraud-proof handlers against the facet's own storage: no channel,
/// no on-chain snapshot, and a real UtilityFacet so block authenticity resolves.
/// The dispute window a case needs is seeded directly; `evidenceTime` is the
/// facet's own config slot, so every period deadline is real arithmetic.
contract WrongGenesisHarness is FraudProofFacet, DisputeWindowSeeding {
    constructor(uint256 harnessEvidenceTime) {
        evidenceTime = harnessEvidenceTime;
        utilityFacetAddress = address(new UtilityFacet());
    }

    function seedDisputeWindow(
        bytes32 channelId,
        bytes32 originForkId,
        uint256 creationTimestamp,
        uint256 lastEvidenceSubmissionTimestamp
    ) external {
        _seedDisputeWindow(channelId, originForkId, creationTimestamp, lastEvidenceSubmissionTimestamp);
    }
}

// test naming: testFuzz_<targetFunction>_<property>
contract FraudProofFacetTest is TimeoutCalldataPostedStaging {
    StateChannelManagerInterface internal diamond;

    uint256 internal constant AUTHOR_PK = 0xA11CE;
    bytes32 internal constant CHANNEL_ID = keccak256("channel");
    bytes32 internal constant FORK_ID = keccak256("fork");
    // non-zero so a deadline is never just the timestamp it was measured from
    uint256 internal constant HARNESS_EVIDENCE_TIME = 10;
    // the honest channel: AUTHOR_PK signs the honest blocks, PEER_PK disputes, CHALLENGER_PK and
    // OUTSIDER submit forged proofs
    bytes32 internal constant HONEST_CHANNEL_ID = keccak256("honest-channel");
    uint256 internal constant PEER_PK = 0xB0B;
    uint256 internal constant CHALLENGER_PK = 0xC4A1;
    address internal constant OUTSIDER = address(0x0B5E);

    function setUp() public {
        diamond = deployDiamond();
    }

    function _genesisProof(uint256 fraudTimestamp, uint256 prevSnapshotTimestamp, bytes32 channelId, bytes32 forkId)
        internal
        pure
        returns (InvalidTimestampProof memory proof)
    {
        StateSnapshot memory prevSnapshot;
        prevSnapshot.timestamp = prevSnapshotTimestamp;
        bytes32 prevHash = keccak256(abi.encode(prevSnapshot));
        proof.invalidBlock = _makeSignedGenesisBlock(AUTHOR_PK, channelId, forkId, fraudTimestamp, prevHash);
        proof.previousStateSnapshot = prevSnapshot;
    }

    function _isFraud(uint256 fraudTimestamp, uint256 prevSnapshotTimestamp) internal returns (bool) {
        return diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prevSnapshotTimestamp, CHANNEL_ID, FORK_ID));
    }

    // genesis branch must never revert on attacker-influenceable input
    function testFuzz_hasInvalidTimestamp_genesisNeverReverts(uint256 fraudTimestamp, uint256 prevSnapshotTimestamp)
        public
    {
        diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prevSnapshotTimestamp, CHANNEL_ID, FORK_ID));
    }

    // non-genesis branch (txCnt > 0) must never revert
    function testFuzz_hasInvalidTimestamp_nonGenesisNeverReverts(uint256 fraudTimestamp, uint256 prevBlockTimestamp)
        public
    {
        SignedBlock memory prevBlock =
            _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 0, prevBlockTimestamp, bytes32(0));
        bytes32 prevHash = keccak256(prevBlock.encodedBlock);
        SignedBlock memory fraudBlock = _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 1, fraudTimestamp, prevHash);

        InvalidTimestampProof memory proof;
        proof.invalidBlock = fraudBlock;
        proof.previousBlock = prevBlock;
        diamond.hasInvalidTimestamp(proof);
    }

    // valid-timestamp region must be one contiguous interval -> no valid/invalid/valid holes
    function testFuzz_hasInvalidTimestamp_validRegionHasNoHoles(uint256 prev, uint256 a, uint256 b, uint256 c) public {
        prev = bound(prev, 1e6, 1e30);
        a = bound(a, prev - 1e6, prev + 1e6);
        b = bound(b, prev - 1e6, prev + 1e6);
        c = bound(c, prev - 1e6, prev + 1e6);
        (uint256 lo, uint256 mid, uint256 hi) = _sort3(a, b, c);

        if (!_isFraud(lo, prev) && !_isFraud(hi, prev)) {
            assertFalse(_isFraud(mid, prev), "hole in valid region");
        }
    }

    // hasInvalidTimestamp is insensitive to channelId/forkId -> same timestamps, same verdict
    function testFuzz_hasInvalidTimestamp_ignoresChannelAndFork(
        uint256 fraudTimestamp,
        uint256 prev,
        bytes32 channelId1,
        bytes32 forkId1,
        bytes32 channelId2,
        bytes32 forkId2
    ) public {
        prev = bound(prev, 1e6, 1e30);
        fraudTimestamp = bound(fraudTimestamp, prev - 1e6, prev + 1e6);

        bool v1 = diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prev, channelId1, forkId1));
        bool v2 = diamond.hasInvalidTimestamp(_genesisProof(fraudTimestamp, prev, channelId2, forkId2));
        assertEq(v1, v2, "verdict leaked onto channelId/forkId");
    }

    // honest on-time block (0..p2pTime skew) can never be slashed
    function testFuzz_hasInvalidTimestamp_honestBlockNeverFraud(uint256 prev, uint256 skew) public {
        prev = bound(prev, 1e6, 1e30);
        skew = bound(skew, 0, diamond.getEvidenceTime() + P2P_TIME);
        assertFalse(_isFraud(prev + skew, prev), "honest on-time block flagged as fraud");
    }

    function test_hasInvalidTimestamp_firstBlockGraceBoundary() public {
        uint256 prev = 1e6;
        uint256 maxValidTimestamp = prev + diamond.getEvidenceTime() + P2P_TIME;

        assertFalse(_isFraud(maxValidTimestamp, prev), "first-block grace boundary flagged as fraud");
        assertTrue(_isFraud(maxValidTimestamp + 1, prev), "timestamp beyond first-block grace accepted");
    }

    function test_hasInvalidTimestamp_laterBlockHasNoFirstBlockGrace() public {
        uint256 prev = 1e6;
        SignedBlock memory previousBlock = _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 0, prev, bytes32(0));
        bytes32 previousHash = keccak256(previousBlock.encodedBlock);

        InvalidTimestampProof memory boundaryProof;
        boundaryProof.invalidBlock = _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 1, prev + P2P_TIME, previousHash);
        boundaryProof.previousBlock = previousBlock;
        assertFalse(diamond.hasInvalidTimestamp(boundaryProof), "later-block p2p boundary flagged as fraud");

        InvalidTimestampProof memory beyondProof;
        beyondProof.invalidBlock =
            _makeSignedBlock(AUTHOR_PK, CHANNEL_ID, FORK_ID, 1, prev + P2P_TIME + 1, previousHash);
        beyondProof.previousBlock = previousBlock;
        assertTrue(diamond.hasInvalidTimestamp(beyondProof), "later block incorrectly received first-block grace");
    }

    // forged signature must be inert regardless of timestamps
    function testFuzz_hasInvalidTimestamp_forgedSignatureInert(uint256 fraudTimestamp, uint256 prev) public {
        prev = bound(prev, 0, 1e30);
        fraudTimestamp = bound(fraudTimestamp, 0, 2e30);
        InvalidTimestampProof memory proof = _genesisProof(fraudTimestamp, prev, CHANNEL_ID, FORK_ID);
        proof.invalidBlock.signature = abi.encodePacked(keccak256("bad-r"), keccak256("bad-s"), uint8(27));
        assertFalse(diamond.hasInvalidTimestamp(proof), "forged-signature block treated as authentic");
    }

    /// A wrong-genesis proof whose genesis snapshot names `originForkId` and
    /// whose block carries the fork that snapshot data hashes to: the handler
    /// only reaches the dispute-window lookup for a snapshot linked to the
    /// block's fork. The block timestamp plays no part on that path.
    function _wrongGenesisProof(bytes32 channelId, bytes32 originForkId)
        internal
        pure
        returns (FraudProof memory fraudProof, bytes32 forkId)
    {
        SnapshotData memory genesisSnapshotData;
        genesisSnapshotData.originForkId = originForkId;
        forkId = keccak256(abi.encode(genesisSnapshotData));

        WrongGenesisProof memory proof;
        proof.invalidBlock = _makeSignedGenesisBlock(AUTHOR_PK, channelId, forkId, 1, bytes32(0));
        proof.genesisSnapshot.snapshotData = genesisSnapshotData;

        fraudProof = FraudProof({
            proofType: FraudProofType.WrongGenesis,
            participant: vm.addr(AUTHOR_PK),
            encodedProof: abi.encode(proof)
        });
    }

    // the submitter names originForkId, so a fork with no window must say so
    function test_runFraudProof_wrongGenesisWithoutDisputeWindow_revertsNamingTheMissingWindow() public {
        WrongGenesisHarness harness = new WrongGenesisHarness(HARNESS_EVIDENCE_TIME);
        bytes32 channelId = keccak256("wrong-genesis-channel");
        bytes32 originForkId = keccak256("wrong-genesis-origin-fork");

        (FraudProof memory fraudProof,) = _wrongGenesisProof(channelId, originForkId);

        vm.expectRevert(abi.encodeWithSelector(RaceConditionDisputeWindowNotOpen.selector, channelId, originForkId));
        harness.runFraudProof(fraudProof, FraudProofVerificationContext({channelId: channelId}));
    }

    // the kill period runs from the LAST evidence submission, not from window
    // creation, and the revert must name that deadline next to the current time
    function test_runFraudProof_wrongGenesisInsideKillPeriod_revertsNamingDeadlineAndCurrentTimestamp() public {
        WrongGenesisHarness harness = new WrongGenesisHarness(HARNESS_EVIDENCE_TIME);
        bytes32 channelId = keccak256("kill-period-channel");
        bytes32 originForkId = keccak256("kill-period-origin-fork");

        // creation is far enough behind the last submission that a deadline
        // measured from creation would already be over at `currentTimestamp`
        uint256 windowCreationTimestamp = 1_234;
        uint256 lastEvidenceSubmissionTimestamp = 5_000;
        uint256 expectedKillPeriodEnd = lastEvidenceSubmissionTimestamp + HARNESS_EVIDENCE_TIME;
        uint256 currentTimestamp = 4_321;

        harness.seedDisputeWindow(channelId, originForkId, windowCreationTimestamp, lastEvidenceSubmissionTimestamp);
        vm.warp(currentTimestamp);

        (FraudProof memory fraudProof,) = _wrongGenesisProof(channelId, originForkId);

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceConditionDisputeKillPeriodNotExpired.selector, expectedKillPeriodEnd, currentTimestamp
            )
        );
        harness.runFraudProof(fraudProof, FraudProofVerificationContext({channelId: channelId}));
    }

    // an open window whose kill period is already over with a zero deadline
    // leaves the handler with no genesis timestamp at all: the fallback reads
    // the on-chain snapshot, which this channel never posted
    function test_runFraudProof_wrongGenesisWithoutGenesisTimestamp_revertsNamingChannelAndBothForks() public {
        WrongGenesisHarness harness = new WrongGenesisHarness(0);
        bytes32 channelId = keccak256("genesis-timestamp-channel");
        bytes32 originForkId = keccak256("genesis-timestamp-origin-fork");

        // creation opens the window; no evidence has been submitted into it, so
        // with a zero evidence time the kill period ends at timestamp zero
        harness.seedDisputeWindow(channelId, originForkId, 1_234, 0);

        (FraudProof memory fraudProof, bytes32 forkId) = _wrongGenesisProof(channelId, originForkId);
        assertTrue(forkId != originForkId, "fork operands must be distinguishable");

        vm.expectRevert(
            abi.encodeWithSelector(RaceConditionGenesisTimestampNotAvailable.selector, channelId, originForkId, forkId)
        );
        harness.runFraudProof(fraudProof, FraudProofVerificationContext({channelId: channelId}));
    }

    // ---- invalid-transition proofs must bind the previous snapshot before judging it ----

    /// An open channel of AUTHOR_PK, PEER_PK and CHALLENGER_PK, and the base its first block
    /// builds on: the genesis snapshot, its state and the snapshot's hash.
    function _openHonestChannel() internal returns (PostedBlockBase memory genesisBase) {
        uint256[] memory pks = new uint256[](3);
        pks[0] = AUTHOR_PK;
        pks[1] = PEER_PK;
        pks[2] = CHALLENGER_PK;
        _openChannel(HONEST_CHANNEL_ID, pks);

        MathState memory state;
        state.participants = new address[](3);
        state.balances = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            state.participants[i] = vm.addr(pks[i]);
        }
        StateSnapshot memory genesis = diamond.getStateSnapshot(HONEST_CHANNEL_ID);
        assertEq(genesis.snapshotData.stateMachineStateHash, keccak256(abi.encode(state)), "staged genesis state");
        genesisBase = PostedBlockBase(genesis, abi.encode(state), keccak256(abi.encode(genesis)));
    }

    /// `add(1)` by `pk` on `base` at `transactionCnt`, with the snapshot hash the handler recomputes,
    /// so the block is honest; returns the base the next block builds on.
    function _honestBlock(uint256 pk, PostedBlockBase memory base, uint256 transactionCnt)
        internal
        returns (SignedBlock memory signedBlock, PostedBlockBase memory nextBase)
    {
        Block memory honestBlock;
        honestBlock.transaction.header.channelId = HONEST_CHANNEL_ID;
        honestBlock.transaction.header.forkId = base.latestStateSnapshot.forkId;
        honestBlock.transaction.header.participant = vm.addr(pk);
        honestBlock.transaction.header.transactionCnt = transactionCnt;
        honestBlock.transaction.header.timestamp = block.timestamp;
        honestBlock.transaction.body.data = abi.encodeCall(MathStateMachine.add, (1));
        honestBlock.previousBlockHash = base.previousBlockHash;
        (StateSnapshot memory next, bytes memory nextState) =
            _fundedReplay(diamond, HONEST_CHANNEL_ID, base, honestBlock.transaction);
        assertTrue(keccak256(nextState) != keccak256(base.encodedLatestState), "staged transition applied");
        assertEq(
            next.snapshotData.originForkId,
            base.latestStateSnapshot.snapshotData.originForkId,
            "replay keeps the parent fork as origin"
        );
        // clients number a block's snapshot by the block's height, so a first block keeps height 0
        next.blockHeight = transactionCnt;
        honestBlock.stateSnapshotHash = keccak256(abi.encode(next));

        bytes memory encodedBlock = abi.encode(honestBlock);
        signedBlock = SignedBlock({encodedBlock: encodedBlock, signature: _sign(pk, encodedBlock)});
        nextBase = PostedBlockBase(next, nextState, keccak256(encodedBlock));
    }

    function _invalidTransitionProof(
        SignedBlock memory invalidBlock,
        bytes memory encodedPreviousBlock,
        StateSnapshot memory previousSnapshot,
        bytes memory previousState
    ) internal pure returns (FraudProof memory) {
        BlockInvalidStateTransitionProof memory proof;
        proof.invalidBlock = invalidBlock;
        proof.previousBlock.encodedBlock = encodedPreviousBlock;
        proof.previousBlockStateSnapshot = previousSnapshot;
        proof.previousStateStateMachineState = previousState;
        return FraudProof({
            proofType: FraudProofType.BlockInvalidStateTransition,
            participant: abi.decode(invalidBlock.encodedBlock, (Block)).transaction.header.participant,
            encodedProof: abi.encode(proof)
        });
    }

    function _applyAs(address submitter, FraudProof memory fraudProof) internal returns (bool ok) {
        FraudProof[] memory proofs = new FraudProof[](1);
        proofs[0] = fraudProof;
        vm.prank(submitter);
        (ok,) = address(diamond).call(
            abi.encodeCall(
                diamond.applyFraudProofs, (proofs, FraudProofVerificationContext({channelId: HONEST_CHANNEL_ID}))
            )
        );
    }

    function _isSlashed(uint256 pk) internal view returns (bool) {
        return diamond.isParticipantSlashedOnChain(HONEST_CHANNEL_ID, vm.addr(pk));
    }

    function _assertNobodySlashed() internal view {
        assertFalse(_isSlashed(AUTHOR_PK), "honest signer slashed");
        assertFalse(_isSlashed(PEER_PK), "peer slashed");
        assertFalse(_isSlashed(CHALLENGER_PK), "challenger slashed");
    }

    // the staged blocks are honest: their genuine predecessors slash nobody
    function test_applyFraudProofs_linkedHonestBlocksKeepSigner() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock, PostedBlockBase memory firstBase) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        (SignedBlock memory laterBlock,) = _honestBlock(PEER_PK, firstBase, 1);

        assertTrue(
            _applyAs(
                vm.addr(CHALLENGER_PK),
                _invalidTransitionProof(firstBlock, "", genesisBase.latestStateSnapshot, genesisBase.encodedLatestState)
            )
        );
        FraudProof memory laterProof = _invalidTransitionProof(
            laterBlock, firstBlock.encodedBlock, firstBase.latestStateSnapshot, firstBase.encodedLatestState
        );
        assertTrue(_applyAs(OUTSIDER, laterProof));
        assertFalse(_isSlashed(AUTHOR_PK), "honest first-block signer slashed");
        assertFalse(_isSlashed(PEER_PK), "honest later-block signer slashed");
        assertTrue(_isSlashed(CHALLENGER_PK), "false proof slashes its participant submitter");
    }

    // any snapshot that is not the first block's predecessor, on any fork -> signer never slashed
    function testFuzz_applyFraudProofs_unlinkedSnapshotNeverSlashesHonestFirstBlockSigner(
        StateSnapshot memory forgedSnapshot,
        bytes memory forgedState
    ) public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock,) = _honestBlock(AUTHOR_PK, genesisBase, 0);

        assertTrue(_applyAs(OUTSIDER, _invalidTransitionProof(firstBlock, "", forgedSnapshot, forgedState)));
        _assertNobodySlashed();
    }

    // any snapshot with the real predecessor, or any decodable predecessor that is not the real one
    // -> an invalid proof that executes and never slashes the signer
    function testFuzz_applyFraudProofs_unlinkedSnapshotNeverSlashesHonestLaterBlockSigner(
        StateSnapshot memory forgedSnapshot,
        bytes memory forgedState,
        TransactionHeader memory forgedHeader,
        bytes memory forgedBody,
        bytes32 forgedStateSnapshotHash,
        bytes32 forgedPreviousBlockHash,
        bool keepRealPreviousBlock
    ) public {
        Block memory forgedPreviousBlock;
        forgedPreviousBlock.transaction.header = forgedHeader;
        forgedPreviousBlock.transaction.body.data = forgedBody;
        forgedPreviousBlock.stateSnapshotHash = forgedStateSnapshotHash;
        forgedPreviousBlock.previousBlockHash = forgedPreviousBlockHash;
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock, PostedBlockBase memory firstBase) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        (SignedBlock memory laterBlock,) = _honestBlock(PEER_PK, firstBase, 1);

        bytes memory previousBlock = keepRealPreviousBlock ? firstBlock.encodedBlock : abi.encode(forgedPreviousBlock);
        assertTrue(_applyAs(OUTSIDER, _invalidTransitionProof(laterBlock, previousBlock, forgedSnapshot, forgedState)));
        _assertNobodySlashed();
    }

    // a decodable predecessor that is not the later block's real one -> a participant submitter pays for it
    function test_applyFraudProofs_wrongPredecessorSlashesParticipantSubmitter() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock, PostedBlockBase memory firstBase) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        (SignedBlock memory laterBlock,) = _honestBlock(PEER_PK, firstBase, 1);
        Block memory wrongPredecessor = abi.decode(firstBlock.encodedBlock, (Block));
        wrongPredecessor.transaction.header.timestamp += 1;

        assertTrue(
            _applyAs(
                vm.addr(CHALLENGER_PK),
                _invalidTransitionProof(
                    laterBlock,
                    abi.encode(wrongPredecessor),
                    firstBase.latestStateSnapshot,
                    firstBase.encodedLatestState
                )
            )
        );
        assertFalse(_isSlashed(PEER_PK), "honest signer slashed");
        assertTrue(_isSlashed(CHALLENGER_PK), "participant submitter slashed");
    }

    // predecessor bytes that do not decode as a block revert the whole call -> nobody is slashed
    function test_applyFraudProofs_undecodablePredecessorRevertsWithoutSlashing() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (, PostedBlockBase memory firstBase) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        (SignedBlock memory laterBlock,) = _honestBlock(PEER_PK, firstBase, 1);

        assertFalse(
            _applyAs(
                vm.addr(CHALLENGER_PK),
                _invalidTransitionProof(
                    laterBlock, hex"01", firstBase.latestStateSnapshot, firstBase.encodedLatestState
                )
            )
        );
        _assertNobodySlashed();
    }

    // a participant submitting the unlinked proof pays for it, the honest signer does not
    function test_applyFraudProofs_unlinkedOtherForkSnapshotSlashesParticipantSubmitter() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock,) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        StateSnapshot memory otherForkSnapshot = genesisBase.latestStateSnapshot;
        otherForkSnapshot.forkId = keccak256("other-fork");

        assertTrue(
            _applyAs(
                vm.addr(CHALLENGER_PK),
                _invalidTransitionProof(firstBlock, "", otherForkSnapshot, genesisBase.encodedLatestState)
            )
        );
        assertFalse(_isSlashed(AUTHOR_PK), "honest signer slashed");
        assertTrue(_isSlashed(CHALLENGER_PK), "participant submitter slashed");
    }

    // a genuinely linked predecessor with a wrong resulting snapshot is still fraud
    function test_applyFraudProofs_linkedInvalidTransitionSlashesSigner() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        Block memory fraudBlock;
        fraudBlock.transaction.header.channelId = HONEST_CHANNEL_ID;
        fraudBlock.transaction.header.forkId = genesisBase.latestStateSnapshot.forkId;
        fraudBlock.transaction.header.participant = vm.addr(AUTHOR_PK);
        fraudBlock.transaction.header.timestamp = block.timestamp;
        fraudBlock.transaction.body.data = abi.encodeCall(MathStateMachine.add, (1));
        fraudBlock.previousBlockHash = genesisBase.previousBlockHash;
        fraudBlock.stateSnapshotHash = keccak256("not-the-replayed-snapshot");
        bytes memory encodedBlock = abi.encode(fraudBlock);
        SignedBlock memory signedBlock =
            SignedBlock({encodedBlock: encodedBlock, signature: _sign(AUTHOR_PK, encodedBlock)});

        assertTrue(
            _applyAs(
                OUTSIDER,
                _invalidTransitionProof(
                    signedBlock, "", genesisBase.latestStateSnapshot, genesisBase.encodedLatestState
                )
            )
        );
        assertTrue(_isSlashed(AUTHOR_PK), "invalid transition not slashed");
    }

    // a signer that links its block to a snapshot of another fork is still slashed
    function test_applyFraudProofs_linkedOtherForkSnapshotSlashesSigner() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory honestFirstBlock,) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        Block memory crossForkBlock = abi.decode(honestFirstBlock.encodedBlock, (Block));
        crossForkBlock.transaction.header.forkId = keccak256("other-fork");
        bytes memory encodedBlock = abi.encode(crossForkBlock);
        SignedBlock memory signedBlock =
            SignedBlock({encodedBlock: encodedBlock, signature: _sign(AUTHOR_PK, encodedBlock)});

        assertTrue(
            _applyAs(
                OUTSIDER,
                _invalidTransitionProof(
                    signedBlock, "", genesisBase.latestStateSnapshot, genesisBase.encodedLatestState
                )
            )
        );
        assertTrue(_isSlashed(AUTHOR_PK), "cross-fork link not slashed");
    }

    // a later block whose real predecessor links to a snapshot of another fork is still slashed
    function test_applyFraudProofs_linkedOtherForkLaterBlockSlashesSigner() public {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock, PostedBlockBase memory firstBase) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        (SignedBlock memory honestLaterBlock,) = _honestBlock(PEER_PK, firstBase, 1);
        Block memory crossForkBlock = abi.decode(honestLaterBlock.encodedBlock, (Block));
        crossForkBlock.transaction.header.forkId = keccak256("other-fork");
        bytes memory encodedBlock = abi.encode(crossForkBlock);
        SignedBlock memory signedBlock =
            SignedBlock({encodedBlock: encodedBlock, signature: _sign(PEER_PK, encodedBlock)});

        assertTrue(
            _applyAs(
                OUTSIDER,
                _invalidTransitionProof(
                    signedBlock, firstBlock.encodedBlock, firstBase.latestStateSnapshot, firstBase.encodedLatestState
                )
            )
        );
        assertTrue(_isSlashed(PEER_PK), "cross-fork link not slashed");
    }

    /// A committed timeout dispute by PEER_PK whose state proof holds the honest first block, and
    /// the dispute proof that wraps an invalid-transition proof of that block on `forgedSnapshot`.
    function _nestedUnlinkedProof(StateSnapshot memory forgedSnapshot, bytes memory forgedState)
        internal
        returns (Dispute memory dispute, DisputeFraudProof[] memory proofs)
    {
        PostedBlockBase memory genesisBase = _openHonestChannel();
        (SignedBlock memory firstBlock,) = _honestBlock(AUTHOR_PK, genesisBase, 0);
        StateProof memory stateProof;
        stateProof.milestones = new MilestoneProof[](1);
        stateProof.milestones[0].blockConfirmations = new BlockConfirmation[](1);
        stateProof.milestones[0].blockConfirmations[0].signedBlock = firstBlock;
        dispute = _uploadTimeoutDispute(
            diamond, HONEST_CHANNEL_ID, genesisBase.latestStateSnapshot.forkId, stateProof, vm.addr(PEER_PK), PEER_PK
        );

        DisputeInvalidBlockInStateProofApplyFraudProof memory nested;
        nested.fraudProof = _invalidTransitionProof(firstBlock, "", forgedSnapshot, forgedState);
        nested.blockIndex = 0;
        proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
            participant: vm.addr(PEER_PK),
            dispute: dispute,
            encodedProof: abi.encode(nested)
        });
    }

    // the unlinked proof nested in a dispute proof never kills the honest dispute
    function testFuzz_applyDisputeFraudProofs_nestedUnlinkedSnapshotNeverKillsHonestDispute(
        StateSnapshot memory forgedSnapshot,
        bytes memory forgedState
    ) public {
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) = _nestedUnlinkedProof(forgedSnapshot, forgedState);

        vm.prank(OUTSIDER);
        (bool ok,) = address(diamond).call(abi.encodeCall(diamond.applyDisputeFraudProofs, (proofs)));
        assertTrue(ok, "an outsider's false proof is a no-op, not a revert");
        assertTrue(_isDisputeCommitted(diamond, dispute), "honest dispute killed");
        _assertNobodySlashed();
    }

    // a participant submitting the nested unlinked proof pays for it, the honest dispute stands
    function test_applyDisputeFraudProofs_nestedUnlinkedOtherForkSnapshotSlashesParticipantSubmitter() public {
        StateSnapshot memory otherForkSnapshot;
        otherForkSnapshot.forkId = keccak256("other-fork");
        (Dispute memory dispute, DisputeFraudProof[] memory proofs) = _nestedUnlinkedProof(otherForkSnapshot, "");

        vm.prank(vm.addr(CHALLENGER_PK));
        diamond.applyDisputeFraudProofs(proofs);
        assertTrue(_isDisputeCommitted(diamond, dispute), "honest dispute killed");
        assertFalse(_isSlashed(PEER_PK), "honest disputer slashed");
        assertFalse(_isSlashed(AUTHOR_PK), "honest signer slashed");
        assertTrue(_isSlashed(CHALLENGER_PK), "participant submitter slashed");
    }

    function _sort3(uint256 x, uint256 y, uint256 z) internal pure returns (uint256, uint256, uint256) {
        if (x > y) (x, y) = (y, x);
        if (y > z) (y, z) = (z, y);
        if (x > y) (x, y) = (y, x);
        return (x, y, z);
    }
}
