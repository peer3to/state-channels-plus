pragma solidity ^0.8.8;

import {console} from "../../../lib/forge-std/src/console.sol";
import {StateProofStaging} from "../harness/StateProofStaging.sol";
import {MathState} from "../../../contracts/V1/examples/MathStateMachine/MathStateMachine.sol";
import {
    ErrorDisputeInboundMessageBlocksInvalid,
    ErrorInboundMessageBlockNotStored,
    INBOUND_FAILURE_HASH_LINK
} from "../../../contracts/V1/StateChannelDiamondProxy/Errors.sol";
import {
    DisputeConflictsWithFinalState,
    DisputeFinalPointRegression
} from "../../../contracts/V1/types/DisputeFraudProofTypes.sol";
import {MESSAGE_TYPE_JOIN} from "../../../contracts/V1/types/MessageTypeHashes.sol";
import "../../../contracts/V1/types/DataTypes.sol";
import "../../../contracts/V1/types/DisputeTypes.sol";
import "../../../contracts/V1/types/ProofTypes.sol";

/// The side-chain bypass of a later joiner and `DisputeFinalPointRegression`, its kill. The chain anchor is 50
/// {A, B, C, D, E}. L posts a JOIN on chain. The honest history X consumes it in the join hop at 60 (signed by A to E
/// and L) and reaches the threshold-final point F = 100, where L has won 30 from A. A to E build the side chain Y from
/// the anchor: one hop to 1000' signed by A to E alone, whose inbound head stays below L's JOIN. Y's walk counts the
/// joiners inside its own inbound interval only, so L is never required. L disputes with X, A disputes with Y, both in
/// one window.
///
/// No block of Y is at F's height, so `DisputeConflictsWithFinalState` cannot remove Y, and `reduce` would pick Y by
/// longest chain. `DisputeFinalPointRegression` kills Y: F = 100 is final with inbound height 2, and Y's latest
/// finalized point G = 1000' is above F with inbound height 1, and F's extra inbound holds L's JOIN, L outside G's
/// participants. The further cases pin the strict inbound boundary, the height boundary, the anchor as G, the snapshot
/// check, the new-joiner rule (a top-up of a participant is no evidence), the inbound lookup and the stored-run guard,
/// and the inbound guard on `DisputeConflictsWithFinalState`: a side-chain final point below a later JOIN cannot kill
/// the honest history, either through an early milestone of the honest proof or through a block at its height.
// test naming: test_<case>_<scenario>
contract DisputeFinalPointRegressionTest is StateProofStaging {
    uint256 internal constant ERIN_KEY = 0xE121;
    uint256 internal constant JOINER_KEY = 0x10E1;
    /// the peer3 parachain runtime's per-transaction gas limit (`MAX_TRANSACTION_GAS` in src/utils/config.ts)
    uint256 internal constant MAX_TRANSACTION_GAS = 17_916_000;
    /// the intrinsic gas every transaction pays before its calldata and execution
    uint256 internal constant TRANSACTION_BASE_GAS = 21_000;
    /// the parachain's per-transaction calldata limit
    uint256 internal constant MAX_CALLDATA_BYTES = 64 * 1024;
    /// the cost case: the staged machine's participant cap, and the final proof's hop count the calldata limit admits
    uint256 internal constant LARGE_PARTICIPANTS = 32;
    uint256 internal constant LARGE_FINAL_HOPS = 7;
    /// the walk-cost case: top-ups of a participant between the anchor's inbound head and L's JOIN
    uint256 internal constant TOP_UP_RUN = 32;
    /// the bound on the extra cost of the check from below the run: before the JOIN hint, the walk of the skipped run
    /// cost 158,503 gas over TOP_UP_RUN blocks on cooled storage (about 4,953 per block), so this bound is under two
    /// skipped blocks
    uint256 internal constant SKIPPED_INBOUND_WALK_GAS = 8_983;
    /// the conflict-cost case: top-ups of a participant G consumed above F's inbound head, at two points
    uint256 internal constant CONFLICT_RUN = 64;
    uint256 internal constant SHORT_CONFLICT_RUN = 16;
    /// the largest final proof's hop count a kill must carry next to a dispute at the upload cap
    uint256 internal constant FINAL_HOP_BOUND = 4;

    address internal erin = vm.addr(ERIN_KEY);
    address internal joiner = vm.addr(JOINER_KEY);

    bytes32 internal openingInboundHash;
    MessageBlock internal joinInbound;
    bytes32 internal joinInboundHash;

    function setUp() public {
        _stageGenesisChannel();
        // the channel opened with A to E's JOINs (inbound height 1); L's JOIN follows at inbound height 2, unconsumed
        // by the anchor
        openingInboundHash = harness.seedInboundBlock(CHANNEL, _openingInbound());
        joinInbound = _joinBlock(openingInboundHash, 2, joiner, 50);
        joinInbound.totalBalance.amount = 550;
        joinInboundHash = harness.seedInboundBlock(CHANNEL, joinInbound);
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        harness.seedSnapshot(CHANNEL, anchor);
    }

    function test_K1_sideChainBypassingALaterJoinerLosesTheReductionToTheJoinersFinalHistory() public {
        // ---- the honest history X: the join hop at 60, then F = 100 where L won 30 from A ----
        (MilestoneProof[] memory honestMilestones, StateSnapshot[] memory honestSnapshots) = _honestHistory();
        (Dispute memory honest, DisputeAuditingData memory honestData) =
            _postedDisputeBy(joiner, honestMilestones, honestSnapshots, honestSnapshots[1]);

        // ---- the side chain Y: one compact hop from the anchor to 1000', below L's JOIN ----
        (StateSnapshot memory sideFinal, bytes memory sideState) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (Dispute memory side, DisputeAuditingData memory sideData) =
            _postedDisputeBy(alice, _one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal), sideFinal);

        _commit(honest);
        _commit(side);

        // premise: both proofs walk valid from the on-chain anchor 50
        assertTrue(_chainAcceptsPostedProof(honest, honestData), "premise: X walks from the anchor");
        assertTrue(_chainAcceptsPostedProof(side, sideData), "premise: Y walks from the anchor without L");
        ProofWalkInput memory honestProof = _finalProof(forkId, honestMilestones, honestSnapshots);
        assertEq(_diamond().verifyMilestones(honestProof).finalizedSnapshot.blockHeight, 100, "premise: F is 100");

        // premise: DisputeConflictsWithFinalState cannot be built, Y has no checked block at F's height
        for (uint256 i = 0; i < side.input.stateProof.milestones.length; i++) {
            for (uint256 j = 0; j < side.input.stateProof.milestones[i].blockConfirmations.length; j++) {
                assertFalse(
                    _diamond()
                        .isDisputeConflictingWithFinalState(
                            side, DisputeConflictsWithFinalState(honestProof, i, j, sideFinal)
                        ),
                    "premise: no block of Y conflicts with F"
                );
            }
        }

        // premise: reduced together, Y wins by longest chain; the reduction consumes L's JOIN, so L's deposit is
        // carried into the new fork, but the new fork starts from Y's state: L's outcomes 60-100 on X are lost
        Dispute[] memory both = new Dispute[](2);
        both[0] = honest;
        both[1] = side;
        ReduceOutput memory reduced = harness.reduce(both);
        assertEq(reduced.latestBlock.transaction.header.transactionCnt, 1000, "premise: reduce picks Y's 1000'");
        assertEq(reduced.latestInboundMessageBlockHash, joinInboundHash, "premise: the reduction consumes L's JOIN");
        (SnapshotData memory nextFork, bytes memory nextState,) =
            harness.reduceOutputToSnapshotData(forkId, reduced, sideFinal, sideState, _inbound(joinInbound));
        MathState memory next = abi.decode(nextState, (MathState));
        assertEq(nextFork.participants.length, 6, "premise: L is a participant of the new fork");
        assertEq(nextFork.participants[5], joiner, "premise: L joins the new fork");
        assertEq(nextFork.totalDeposits.amount, 550, "premise: L's deposit is carried");
        assertEq(next.number, 1000, "premise: the new fork continues Y's state");
        assertEq(next.balances[0], 100, "premise: A's loss to L on X is undone");
        assertEq(next.balances[5], 50, "premise: L holds its bare deposit, not its final 80 on X");

        // the defense: L, online in the kill period, proves F = 100 final (inbound 2) and Y's latest finalized point
        // G = 1000' above it (inbound 1)
        _applyBy(
            joiner, side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(honestProof, sideFinal)
        );

        assertEq(harness.commitmentCount(CHANNEL, forkId), 1, "Y is killed, X stays");
        assertTrue(harness.isSlashed(CHANNEL, alice), "Y's disputer is slashed");
        assertFalse(harness.isSlashed(CHANNEL, joiner), "the challenger L keeps its seat");
        // the property: reduce over the disputes the kill period leaves keeps the joiner's final history
        assertEq(
            harness.reduce(_only(honest)).latestBlock.transaction.header.transactionCnt,
            100,
            "reduce keeps L's final outcomes 60-100 on X"
        );
    }

    // ==================== fork choice around a final point ====================

    function test_K2_sideChainWhoseUnfinalTailConsumedTheJoinWithoutTheJoinersSignatureIsStillKilled() public {
        // E's top-up follows L's JOIN at inbound height 3
        MessageBlock memory topUp = _joinBlock(joinInboundHash, 3, erin, 10);
        topUp.totalBalance.amount = 560;
        bytes32 topUpHash = harness.seedInboundBlock(CHANNEL, topUp);
        (MilestoneProof[] memory honestMilestones, StateSnapshot[] memory honestSnapshots) = _honestHistory();
        (Dispute memory honest,) = _postedDisputeBy(joiner, honestMilestones, honestSnapshots, honestSnapshots[1]);
        // Y: the hop to 1000' below L's JOIN, then a tail signed by A alone: 1001' consumed L's JOIN, 1002' also
        // E's top-up
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory tailJoin,) =
            _mathSnapshot(1001, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        (StateSnapshot memory tailTopUp,) = _mathSnapshot(1002, _joinedSet(), _balances(100, 100, 50), topUpHash, 3);
        MilestoneProof memory sideRun = _hopRun(sideFinal, 3, _anchorKeys());
        _commitAt(sideRun, 1, keccak256(abi.encode(tailJoin)), _signers(ALICE_KEY));
        _commitAt(sideRun, 2, keccak256(abi.encode(tailTopUp)), _signers(ALICE_KEY));
        (Dispute memory side,) = _postedDisputeBy(alice, _one(sideRun), _entries(sideFinal), tailTopUp);
        _commit(honest);
        _commit(side);
        assertEq(
            _walk(_one(sideRun), _entries(sideFinal)).finalizedSnapshot.blockHeight,
            1000,
            "premise: Y's tail finalizes nothing, its latest finalized point stays 1000'"
        );
        Dispute[] memory both = new Dispute[](2);
        both[0] = honest;
        both[1] = side;
        assertEq(
            harness.reduce(both).latestBlock.transaction.header.transactionCnt,
            1002,
            "premise: unchallenged, reduce picks Y's tail head 1002'"
        );

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideFinal)
        );

        assertEq(harness.commitmentCount(CHANNEL, forkId), 1, "Y is killed, X stays");
        assertTrue(harness.isSlashed(CHANNEL, alice), "Y's disputer is slashed");
        assertFalse(harness.isSlashed(CHANNEL, joiner), "the challenger L keeps its seat");
    }

    function test_K3_disputeExtendingTheFinalPointIsNotKilledAndWinsTheReductionByLength() public {
        (MilestoneProof[] memory honestMilestones, StateSnapshot[] memory honestSnapshots) = _honestHistory();
        (Dispute memory finalDispute,) = _postedDisputeBy(joiner, honestMilestones, honestSnapshots, honestSnapshots[1]);
        // B's dispute D extends F: X's hops at 60 and 100, then a hop to 150 with F's inbound head
        (StateSnapshot memory later,) = _mathSnapshot(150, _joinedSet(), _balances(60, 100, 90), joinInboundHash, 2);
        (Dispute memory extending,) = _postedDisputeBy(
            bob,
            _three(honestMilestones[0], honestMilestones[1], _hopRun(later, 1, _joinedKeys())),
            _entries(honestSnapshots[0], honestSnapshots[1], later),
            later
        );
        _commit(finalDispute);
        _commit(extending);
        ProofWalkInput memory finalProof = _honestFinalProof();
        assertFalse(
            _diamond()
                .isDisputeConflictingWithFinalState(extending, DisputeConflictsWithFinalState(finalProof, 1, 0, later)),
            "D's block at F's height commits F: no conflict"
        );

        _applyBy(
            joiner, extending, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(finalProof, later)
        );

        _assertBothStayAndChallengerPays(extending, joiner);
        Dispute[] memory both = new Dispute[](2);
        both[0] = finalDispute;
        both[1] = extending;
        assertEq(
            harness.reduce(both).latestBlock.transaction.header.transactionCnt, 150, "reduce picks D by longest chain"
        );
    }

    function test_K4_signaturesWithheldFromOurTailLetTheAttackerProveOnlyAPointOurHeadExtends() public {
        // two top-ups follow L's JOIN: E's at inbound height 3, B's at 4
        MessageBlock memory erinTopUp = _joinBlock(joinInboundHash, 3, erin, 10);
        erinTopUp.totalBalance.amount = 560;
        bytes32 erinTopUpHash = harness.seedInboundBlock(CHANNEL, erinTopUp);
        MessageBlock memory bobTopUp = _joinBlock(erinTopUpHash, 4, bob, 10);
        bobTopUp.totalBalance.amount = 570;
        bytes32 bobTopUpHash = harness.seedInboundBlock(CHANNEL, bobTopUp);
        // our dispute: X's join hop at 60, then F = 100 with a tail where 101 consumed E's top-up and 102 B's
        (MilestoneProof[] memory honestMilestones, StateSnapshot[] memory honestSnapshots) = _honestHistory();
        (StateSnapshot memory atOneOhOne,) = _mathSnapshot(101, _joinedSet(), _balances(70, 100, 80), erinTopUpHash, 3);
        (StateSnapshot memory atOneOhTwo,) = _mathSnapshot(102, _joinedSet(), _balances(70, 100, 80), bobTopUpHash, 4);
        MilestoneProof memory ourRun = _hopRun(honestSnapshots[1], 3, _joinedKeys());
        _commitAt(ourRun, 1, keccak256(abi.encode(atOneOhOne)), _signers(ALICE_KEY));
        _commitAt(ourRun, 2, keccak256(abi.encode(atOneOhTwo)), _signers(ALICE_KEY));
        (Dispute memory ours,) =
            _postedDisputeBy(joiner, _two(honestMilestones[0], ourRun), honestSnapshots, atOneOhTwo);
        _commit(ours);
        // the attacker C holds every signature on our block 101, which we never received: F' = 101 is final
        MilestoneProof memory withheld;
        withheld.blockConfirmations = new BlockConfirmation[](1);
        withheld.blockConfirmations[0] =
            _blockConfirmation(ourRun.blockConfirmations[1].signedBlock.encodedBlock, _joinedKeys());
        ProofWalkInput memory attackerProof =
            _finalProof(forkId, _two(honestMilestones[0], withheld), _entries(honestSnapshots[0], atOneOhOne));
        assertEq(
            _diamond().verifyMilestones(attackerProof).finalizedSnapshot.blockHeight, 101, "premise: F' = 101 is final"
        );
        Dispute memory attackers = _disputeBy(carol, _two(honestMilestones[0], withheld));
        _commit(attackers);
        assertFalse(
            _diamond()
                .isDisputeConflictingWithFinalState(
                    ours, DisputeConflictsWithFinalState(attackerProof, 1, 1, honestSnapshots[1])
                ),
            "our block 101 commits F': no conflict"
        );

        _applyBy(
            carol,
            ours,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(attackerProof, honestSnapshots[1])
        );

        _assertBothStayAndChallengerPays(ours, carol);
        Dispute[] memory both = new Dispute[](2);
        both[0] = ours;
        both[1] = attackers;
        assertEq(harness.reduce(both).latestBlock.transaction.header.transactionCnt, 102, "longest chain keeps our 102");
    }

    function test_K5_latestFinalizedPointBelowTheFinalPointWithATailPastItIsKilledByTheConflict() public {
        // Y: the hop to 80 below L's JOIN, then a tail signed by A alone past F's height 100
        (StateSnapshot memory sideEighty,) =
            _mathSnapshot(80, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        MilestoneProof memory sideRun = _hopRun(sideEighty, 22, _anchorKeys());
        Dispute memory side = _disputeBy(alice, _one(sideRun));
        _commit(side);
        ProofWalkInput memory finalProof = _honestFinalProof();
        assertEq(_decode(sideRun, 20).transaction.header.transactionCnt, 100, "premise: Y's block 20 is at F's height");
        assertFalse(
            _diamond()
                .isDisputeFinalPointRegression(
                    side, DisputeFinalPointRegression(finalProof, sideEighty, _joinHint(finalProof, sideEighty))
                ),
            "premise: G = 80 is below F, the regression counter cannot kill"
        );

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 20, sideEighty)
        );

        _assertKilledBy(side, joiner);
    }

    function test_K8_latestFinalizedSnapshotWithAFalseLargerInboundHeightIsReadAtItsStoredHeight() public {
        // Y's 1000' names the opening inbound block, stored at height 1, but its snapshot claims height 5 (above F's 2)
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 5);
        Dispute memory side = _sideDispute(sideFinal);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideFinal)
        );

        _assertKilledBy(side, joiner);
    }

    function test_K9_anchorInsideTheLastMilestoneIsTheLatestFinalizedPointNotATailBlock() public {
        // Y's only milestone is the run 45..65 holding the anchor 50; its tail block 62 commits a snapshot below
        // L's JOIN, above F = 60
        MilestoneProof memory run = _anchorInsideRun();
        (StateSnapshot memory tailClaim,) =
            _mathSnapshot(62, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        _commitAt(run, 17, keccak256(abi.encode(tailClaim)), _signers(ALICE_KEY));
        Dispute memory side = _disputeBy(alice, _one(run));
        _commit(side);

        // the prover names the tail block 62 as G: G is the anchor, the walk's start, never above F
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_finalJoinProofAtSixty(joinInboundHash, 2), tailClaim)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_K9_anchorInsideTheLastMilestoneIsTheLatestFinalizedPointOfTheConflictCheck() public {
        // an outsider's JOIN follows L's at inbound height 3
        address outsider = vm.addr(0x0B51DE);
        bytes32 outsiderJoinHash = harness.seedInboundBlock(CHANNEL, _joinBlock(joinInboundHash, 3, outsider, 50));
        ProofWalkInput memory finalProof = _finalJoinProofAtSixty(joinInboundHash, 2);
        // Y's only milestone is the run 45..65 holding the anchor 50; its block 60 commits another snapshot than F
        Dispute memory side = _disputeBy(alice, _one(_anchorInsideRun()));
        _commit(side);
        // the prover names a snapshot past the outsider's JOIN as G: the chain reads the anchor's inbound instead
        address[] memory withOutsider = new address[](7);
        for (uint256 i = 0; i < 6; i++) {
            withOutsider[i] = _joinedSet()[i];
        }
        withOutsider[6] = outsider;
        StateSnapshot memory claimed = _snapshotAt(45, withOutsider, outsiderJoinHash, 3);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 15, claimed)
        );

        _assertKilledBy(side, joiner);
    }

    function test_K11_chainAnchorAsTheFinalPointKillsASideChainBelowItsInbound() public {
        // the anchor 50 {A to E, L} consumed L's JOIN (stored, inbound height 2)
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        harness.seedSnapshot(CHANNEL, anchor);
        // L's final proof is the anchor run alone: F is the anchor
        MilestoneProof memory anchorRun = _run(50, 2, keccak256("block 49"), _signers(ALICE_KEY));
        _commitAt(anchorRun, 0, keccak256(abi.encode(anchor)), _signers(ALICE_KEY));
        ProofWalkInput memory anchorProof = _finalProof(forkId, _one(anchorRun), _entries(anchor));
        assertEq(
            keccak256(abi.encode(_diamond().verifyMilestones(anchorProof).finalizedSnapshot)),
            keccak256(abi.encode(anchor)),
            "premise: F is the anchor"
        );
        // Y's 1000' names the opening inbound head (inbound 1), below L's JOIN
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideFinal);

        _applyBy(
            joiner, side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(anchorProof, sideFinal)
        );

        _assertKilledBy(side, joiner);
    }

    function test_K12_unchallengedSideChainWinsTheReductionAndTheJoinerKeepsOnlyItsDeposit() public {
        (MilestoneProof[] memory honestMilestones, StateSnapshot[] memory honestSnapshots) = _honestHistory();
        (Dispute memory honest,) = _postedDisputeBy(joiner, honestMilestones, honestSnapshots, honestSnapshots[1]);
        (StateSnapshot memory sideFinal, bytes memory sideState) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideFinal);
        _commit(honest);
        Dispute[] memory both = new Dispute[](2);
        both[0] = honest;
        both[1] = side;

        // nobody sends the regression counter in the kill period
        ReduceOutput memory reduced = harness.reduce(both);

        assertEq(reduced.latestBlock.transaction.header.transactionCnt, 1000, "reduce picks Y's 1000'");
        (, bytes memory nextState,) =
            harness.reduceOutputToSnapshotData(forkId, reduced, sideFinal, sideState, _inbound(joinInbound));
        MathState memory next = abi.decode(nextState, (MathState));
        assertEq(next.balances[0], 100, "A's loss to L on X is undone");
        assertEq(next.balances[5], 50, "L holds its bare deposit");
    }

    // L's JOIN is consumed only in our unfinal tail; the other dispute's final inbound (1) is not below ours (1)
    function test_K13_joinOnlyInOurUnfinalTailIsNotKillableAndTheWinnerAdmitsTheJoinerWithItsBareDeposit() public {
        (Dispute memory ours, ProofWalkInput memory ourFinalProof) = _ourDisputeWithTheJoinInAnUnfinalTail();
        _commit(ours);
        (StateSnapshot memory sideFinal, bytes memory sideState) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideFinal);

        Dispute[] memory both = new Dispute[](2);
        both[0] = ours;
        both[1] = side;
        // reduced before any allegation: a failed allegation slashes its challenger, which the fold then removes
        ReduceOutput memory reduced = harness.reduce(both);
        assertEq(reduced.latestBlock.transaction.header.transactionCnt, 1000, "reduce picks the side chain's 1000'");
        (SnapshotData memory nextFork, bytes memory nextState,) =
            harness.reduceOutputToSnapshotData(forkId, reduced, sideFinal, sideState, _inbound(joinInbound));
        MathState memory next = abi.decode(nextState, (MathState));
        assertEq(nextFork.participants.length, 6, "L is a participant of the new fork");
        assertEq(nextFork.participants[5], joiner, "L joins through the pending inbound run");
        assertEq(next.balances[5], 50, "L holds its bare deposit; its unfinal outcome is lost");
        // the anchor's 500 plus L's 50
        assertEq(nextFork.totalDeposits.amount, 550, "L's deposit is carried");

        // B proves our final point F = 100 against the side chain's G = 1000': F holds no inbound above G's
        _applyBy(
            bob, side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(ourFinalProof, sideFinal)
        );

        _assertBothStayAndChallengerPays(side, bob);
    }

    // the winner's own unfinal tail consumed L's JOIN: the successor adds no inbound on top of it
    function test_K13_winnerThatConsumedTheJoinInItsOwnTailCarriesTheDepositOnce() public {
        (Dispute memory ours,) = _ourDisputeWithTheJoinInAnUnfinalTail();
        _commit(ours);
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory sideTail, bytes memory sideTailState) =
            _mathSnapshot(1001, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        MilestoneProof memory sideRun = _hopRun(sideFinal, 2, _anchorKeys());
        _commitAt(sideRun, 1, keccak256(abi.encode(sideTail)), _signers(ALICE_KEY));
        (Dispute memory side,) = _postedDisputeBy(alice, _one(sideRun), _entries(sideFinal), sideTail);
        _commit(side);
        Dispute[] memory both = new Dispute[](2);
        both[0] = ours;
        both[1] = side;
        ReduceOutput memory reduced = harness.reduce(both);
        assertEq(reduced.latestBlock.transaction.header.transactionCnt, 1001, "premise: reduce picks the tail 1001'");

        (SnapshotData memory nextFork, bytes memory nextState,) =
            harness.reduceOutputToSnapshotData(forkId, reduced, sideTail, sideTailState, new MessageBlock[](0));

        MathState memory next = abi.decode(nextState, (MathState));
        assertEq(nextFork.participants.length, 6, "L is a participant once");
        assertEq(next.balances[5], 50, "L holds its deposit once");
        // the tail's 550 already holds L's 50; a second count would be 600
        assertEq(nextFork.totalDeposits.amount, 550, "the deposit counts once");
        // offering L's JOIN again does not link to the tail's inbound head
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrorDisputeInboundMessageBlocksInvalid.selector,
                joinInboundHash,
                joinInboundHash,
                joinInboundHash,
                0,
                1,
                INBOUND_FAILURE_HASH_LINK
            )
        );
        harness.reduceOutputToSnapshotData(forkId, reduced, sideTail, sideTailState, _inbound(joinInbound));
    }

    function test_K14_sideChainOmittingItsAuditingDataWithoutThePendingJoinersSignatureIsKilled() public {
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        // Y omits its auditing data; at upload the chain's inbound head is L's JOIN, so L is pending
        Dispute memory side = _disputeBy(alice, _one(_hopRun(sideFinal, 1, _anchorKeys())));
        side.input.latestInboundMessageBlockHash = joinInboundHash;
        side.input.lastInboundMessageBlockHeight = 2;
        Dispute memory signedByTheJoiner = _disputeBy(alice, _one(_hopRun(sideFinal, 1, _joinedKeys())));
        signedByTheJoiner.input.latestInboundMessageBlockHash = joinInboundHash;
        signedByTheJoiner.input.lastInboundMessageBlockHeight = 2;
        assertTrue(harness.isAuditingDataOmissionAllowed(signedByTheJoiner), "premise: with L's signature it may omit");
        assertFalse(harness.isAuditingDataOmissionAllowed(side), "premise: without L's signature it may not");
        _commit(side);

        _apply(side, DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData, _notFinalProof());

        _assertKilled(side);
    }

    // ==================== DisputeFinalPointRegression boundaries ====================

    function test_regression_latestFinalizedPointWithTheFinalPointsInboundDoesNotKill() public {
        // Y's 1000' consumed L's JOIN too (inbound 2 = F's): no inbound went missing
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        Dispute memory side = _sideDispute(sideFinal);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideFinal)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_regression_latestFinalizedPointAtTheFinalHeightDoesNotKill() public {
        // Y's G is at F's height 100 with the lower inbound: not above F (a conflict at that height is another proof)
        (StateSnapshot memory sideHundred,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideHundred);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), sideHundred)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_CN3_finalProofWhoseLastHopSnapshotNamesALowerHeightDoesNotKill() public {
        (Dispute memory side, StateSnapshot memory sideFinal) = _sideAtThousand(openingInboundHash, 1);
        // X's join hop at 60, then block 2000 (above Y's G = 1000') committing, signed by A to E and L, the snapshot
        // that names height 100
        (StateSnapshot memory joinHop,) = _mathSnapshot(60, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        (StateSnapshot memory misHeighted,) =
            _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
        MilestoneProof memory lastHop = _run(2000, 1, keccak256(abi.encode("predecessor", 2000)), _joinedKeys());
        _commitAt(lastHop, 0, keccak256(abi.encode(misHeighted)), _joinedKeys());
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _two(_hopRun(joinHop, 1, _joinedKeys()), lastHop), _entries(joinHop, misHeighted));
        bytes memory proof = _regressionProofWithHint(finalProof, sideFinal, joinInboundHash);
        assertFalse(_diamond().verifyMilestones(finalProof).valid, "F's last hop proves no state at another height");

        _applyBy(joiner, side, DisputeFraudProofType.DisputeFinalPointRegression, proof);

        _assertRejectedBy(side, joiner);
    }

    function test_regression_snapshotTheLatestFinalizedBlockDoesNotCommitDoesNotKill() public {
        // Y's 1000' really consumed L's JOIN (inbound 2); the challenger claims a snapshot at inbound 1 instead
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        Dispute memory side = _sideDispute(sideFinal);
        (StateSnapshot memory claimed,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), claimed)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_regression_anchorAsTheLatestFinalizedPointDoesNotKill() public {
        // Y's only milestone is the run holding the anchor 50: its latest finalized point is the anchor itself
        Dispute memory side = _disputeBy(alice, _one(_run(50, 3, keccak256("block 49"), _anchorKeys())));
        _commit(side);
        (StateSnapshot memory claimed,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(_honestFinalProof(), claimed)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_regression_finalPointWhoseExtraInboundIsOnlyATopUpDoesNotKill() public {
        (bytes32 topUpHash,) = _seedTopUpThenLateJoin();
        // L's forced-inclusion dispute: its history X consumed neither E's top-up nor L's JOIN, G = 100 at inbound 1
        (StateSnapshot memory lagging,) = _mathSnapshot(100, _anchorSet(), _balances(70, 100, 0), openingInboundHash, 1);
        (Dispute memory forcedInclusion,) =
            _postedDisputeBy(joiner, _one(_hopRun(lagging, 1, _anchorKeys())), _entries(lagging), lagging);
        _commit(forcedInclusion);
        // A to E's hidden final point F' = 55 consumed only E's top-up (inbound 2): E is one of G's participants
        (StateSnapshot memory sideFinal,) = _mathSnapshot(55, _anchorSet(), _balances(100, 100, 0), topUpHash, 2);
        ProofWalkInput memory sideProof =
            _finalProof(forkId, _one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal));
        assertEq(_diamond().verifyMilestones(sideProof).finalizedSnapshot.blockHeight, 55, "premise: F' = 55 is final");

        _apply(forcedInclusion, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(sideProof, lagging));

        _assertRejected(forcedInclusion);
    }

    function test_regression_finalPointWhoseExtraInboundHoldsATopUpAndANewJoinerKills() public {
        (, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        // F = 100 consumed E's top-up and L's JOIN (inbound 3), signed by A to E and L
        (StateSnapshot memory finalPoint,) = _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), lateJoinHash, 3);
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(finalPoint, 1, _joinedKeys())), _entries(finalPoint));
        assertEq(
            _diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 100, "premise: F = 100 is final"
        );
        // Y's G = 1000' consumed neither (inbound 1)
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideFinal);

        _applyBy(
            joiner, side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(finalProof, sideFinal)
        );

        _assertKilledBy(side, joiner);
    }

    function test_FR1_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAnEarlyMilestone() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        (Dispute memory honest, StateSnapshot memory honestLatestFinalized) =
            _honestDisputeOverTheLateJoin(lateJoinHash);
        // A to E's side-chain final point F' = 55 consumed E's top-up (inbound 2) but not L's JOIN
        (StateSnapshot memory sideFinal,) = _mathSnapshot(55, _anchorSet(), _balances(100, 100, 0), topUpHash, 2);
        ProofWalkInput memory sideProof =
            _finalProof(forkId, _one(_hopRun(sideFinal, 1, _anchorKeys())), _entries(sideFinal));
        assertEq(_diamond().verifyMilestones(sideProof).finalizedSnapshot.blockHeight, 55, "premise: F' = 55 is final");
        // premise: X's early hop at 60 is above F' with inbound 1, but X's latest finalized point 100 has inbound 3

        _apply(
            honest,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProof(sideProof, honestLatestFinalized)
        );

        _assertRejected(honest);
    }

    function test_FR2_sideChainFinalPointBelowTheJoinCannotKillTheHonestDisputeThroughAConflict() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        (Dispute memory honest, StateSnapshot memory honestLatestFinalized) =
            _honestDisputeOverTheLateJoin(lateJoinHash);
        // A to E's side-chain final point F' = 60 (inbound 2) commits another snapshot than X's hop at 60 (inbound 1)
        ProofWalkInput memory sideProof = _sideFinalAtSixty(topUpHash);

        _apply(
            honest,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(sideProof, 0, 0, honestLatestFinalized)
        );

        _assertRejected(honest);
    }

    function test_FR2_conflictWithTheLatestFinalizedPointsInboundKills() public {
        (bytes32 topUpHash,) = _seedTopUpThenLateJoin();
        ProofWalkInput memory finalProof = _sideFinalAtSixty(topUpHash);
        // A's dispute holds one hop at 60 that commits another snapshot than F, with F's inbound 2
        (StateSnapshot memory forked,) = _mathSnapshot(60, _anchorSet(), _balances(70, 100, 0), topUpHash, 2);
        Dispute memory dispute = _disputeBy(alice, _one(_hopRun(forked, 1, _anchorKeys())));
        _commit(dispute);

        _apply(dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0, forked));

        _assertKilled(dispute);
    }

    function test_conflict_latestFinalizedPointWhoseExtraInboundIsOnlyATopUpKills() public {
        (bytes32 topUpHash,) = _seedTopUpThenLateJoin();
        // L's final point F = 100 at inbound 1, signed by A to E
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _anchorSet(), _balances(70, 100, 0), openingInboundHash, 1);
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(finalPoint, 1, _anchorKeys())), _entries(finalPoint));
        assertEq(
            _diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 100, "premise: F = 100 is final"
        );
        // Y holds block 100 at inbound 2: above F's head it consumed only E's top-up, E is one of F's participants
        (StateSnapshot memory sideHundred,) = _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), topUpHash, 2);
        Dispute memory side = _sideDispute(sideHundred);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 0, sideHundred)
        );

        _assertKilledBy(side, joiner);
    }

    function test_conflict_anchorAsTheLatestFinalizedPointReadsTheAnchorsInbound() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        ProofWalkInput memory finalProof = _sideFinalAtSixty(topUpHash);
        // A's dispute is the run 50..61 holding the anchor; its block 60 commits another snapshot than F
        Dispute memory dispute = _disputeBy(alice, _one(_run(50, 12, keccak256("block 49"), _anchorKeys())));
        _commit(dispute);
        // a snapshot at inbound 3 the anchor block does not commit: the chain reads the anchor's inbound 1 instead
        (StateSnapshot memory claimed,) = _mathSnapshot(50, _joinedSet(), _balances(100, 100, 50), lateJoinHash, 3);

        _apply(
            dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 10, claimed)
        );

        _assertKilled(dispute);
    }

    function test_conflict_unfinalizedGenesisBlockZeroDoesNotRaiseTheInboundCheck() public {
        (ProofWalkInput memory finalProof, StateSnapshot memory carolJoined) = _genesisStartWithCarolsJoin();
        // A's block 0 consumed C's JOIN (inbound 1) but only A signed it: it finalizes nothing, so the dispute's latest
        // finalized point is the fork genesis, not block 0
        Dispute memory dispute = _disputeBy(alice, _one(_genesisRunTo(carolJoined, 1, _signers(ALICE_KEY))));
        _commit(dispute);

        _apply(
            dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0, carolJoined)
        );

        _assertKilled(dispute);
    }

    function test_conflict_finalGenesisBlockZeroAboveTheFinalPointsInboundDoesNotKill() public {
        (ProofWalkInput memory finalProof, StateSnapshot memory carolJoined) = _genesisStartWithCarolsJoin();
        // C's block 0 consumed its own JOIN (inbound 1) and A, B and C signed it: block 0 is final and consumed more
        // inbound than F
        Dispute memory dispute =
            _disputeBy(carol, _one(_genesisRunTo(carolJoined, 1, _signers(ALICE_KEY, BOB_KEY, CAROL_KEY))));
        _commit(dispute);

        _apply(
            dispute, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(finalProof, 0, 0, carolJoined)
        );

        _assertRejected(dispute);
    }

    function test_conflict_snapshotTheLatestFinalizedBlockDoesNotCommitDoesNotKill() public {
        (bytes32 topUpHash, bytes32 lateJoinHash) = _seedTopUpThenLateJoin();
        (Dispute memory honest,) = _honestDisputeOverTheLateJoin(lateJoinHash);
        // X's hop at 60 (inbound 1) conflicts with F' = 60 (inbound 2); X's real G = 100 consumed L's JOIN
        // (inbound 3), the challenger claims a snapshot of 100 at inbound 1 instead
        ProofWalkInput memory sideProof = _sideFinalAtSixty(topUpHash);
        (StateSnapshot memory claimed,) = _mathSnapshot(100, _anchorSet(), _balances(70, 100, 0), openingInboundHash, 1);

        _apply(honest, DisputeFraudProofType.DisputeConflictsWithFinalState, _conflictProof(sideProof, 0, 0, claimed));

        _assertRejected(honest);
    }

    // ==================== the inbound lookup ====================

    function test_lookup_anchorInboundHeadOutsideStorageReadsTheAnchorsHeight() public {
        // the anchor's inbound head at height 7 is not stored (the run below it was pruned); L's JOIN follows at 8
        bytes32 prunedHead = keccak256("an inbound head whose block is not stored");
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), prunedHead, 7);
        harness.seedSnapshot(CHANNEL, anchor);
        bytes32 joinAboveHash = harness.seedInboundBlock(CHANNEL, _joinBlock(prunedHead, 8, joiner, 50));
        ProofWalkInput memory finalProof = _finalJoinProofAtSixty(joinAboveHash, 8);
        // Y's G = 100 is the anchor's inbound head: the chain reads the anchor's height 7 < 8
        (StateSnapshot memory sideHundred,) = _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), prunedHead, 7);
        Dispute memory side = _sideDispute(sideHundred);

        _apply(side, DisputeFraudProofType.DisputeFinalPointRegression, _regressionProof(finalProof, sideHundred));

        _assertKilled(side);
    }

    function test_lookup_extraInboundFromTheAnchorsUnstoredInboundHeadReverts() public {
        // the anchor's inbound head at height 7 is not stored, and F consumed exactly that head: the blocks above
        // G's stored head cannot be read
        bytes32 prunedHead = keccak256("an inbound head whose block is not stored");
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), prunedHead, 7);
        harness.seedSnapshot(CHANNEL, anchor);
        (StateSnapshot memory finalPoint,) = _mathSnapshot(60, _anchorSet(), _balances(90, 100, 0), prunedHead, 7);
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(finalPoint, 1, _anchorKeys())), _entries(finalPoint));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 60, "premise: F = 60 is final");
        // Y's G = 100 consumed the stored opening block only (inbound 1 < 7)
        (StateSnapshot memory sideHundred,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideHundred);
        bytes memory encodedProof = _regressionProof(finalProof, sideHundred);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, prunedHead));
        _apply(side, DisputeFraudProofType.DisputeFinalPointRegression, encodedProof);

        _assertNobodySlashed(side, bob);
    }

    function test_lookup_latestFinalizedHeadPrunedBelowTheAnchorReverts() public {
        // the anchor's stored inbound head Q (height 2) links to a pruned block P (height 1); L's JOIN R follows Q at
        // height 3
        bytes32 prunedHash = keccak256("a pruned inbound block below the anchor");
        MessageBlock memory anchorHead = _joinBlock(prunedHash, 2, erin, 10);
        bytes32 anchorHeadHash = harness.seedInboundBlock(CHANNEL, anchorHead);
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), anchorHeadHash, 2);
        harness.seedSnapshot(CHANNEL, anchor);
        bytes32 joinAboveHash = harness.seedInboundBlock(CHANNEL, _joinBlock(anchorHeadHash, 3, joiner, 50));
        ProofWalkInput memory finalProof = _finalJoinProofAtSixty(joinAboveHash, 3);
        // Y's G = 100 names the pruned P (inbound 1): the chain cannot read its height
        (StateSnapshot memory sideHundred,) = _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), prunedHash, 1);
        Dispute memory side = _sideDispute(sideHundred);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, prunedHash));
        _apply(
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideHundred, joinAboveHash)
        );

        _assertNobodySlashed(side, bob);
    }

    function test_lookup_inboundHashNeitherStoredNorTheAnchorHeadReverts() public {
        bytes32 neverPosted = keccak256("an inbound block the chain never held");
        (StateSnapshot memory sideFinal,) = _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), neverPosted, 3);
        Dispute memory side = _sideDispute(sideFinal);
        bytes memory encodedProof = _regressionProof(_honestFinalProof(), sideFinal);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, neverPosted));
        _applyBy(joiner, side, DisputeFraudProofType.DisputeFinalPointRegression, encodedProof);
    }

    function test_lookup_conflictWithAnInboundHashNeitherStoredNorTheAnchorHeadReverts() public {
        bytes32 neverPosted = keccak256("an inbound block the chain never held");
        // Y's block at F's height 100 commits another snapshot than F, and names an inbound head the chain never held
        (StateSnapshot memory sideHundred,) = _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), neverPosted, 3);
        Dispute memory side = _sideDispute(sideHundred);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, neverPosted));
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(_honestFinalProof(), 0, 0, sideHundred)
        );

        _assertNobodySlashed(side, joiner);
    }

    // ==================== the JOIN hint ====================

    function test_hint_topUpInsideTheSkippedRunDoesNotKill() public {
        (ProofWalkInput memory finalProof, bytes32 topUpHash,) = _lateJoinFinalProof();
        (Dispute memory side, StateSnapshot memory sideFinal) = _sideAtThousand(openingInboundHash, 1);

        // E's top-up lies above G's head and at most F's head, but E is one of G's participants
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideFinal, topUpHash)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_hint_joinAtTheLatestFinalizedInboundHeightDoesNotKill() public {
        (ProofWalkInput memory finalProof, bytes32 topUpHash,) = _lateJoinFinalProof();
        (Dispute memory side, StateSnapshot memory sideFinal) = _sideAtThousand(topUpHash, 2);

        // L's setup JOIN is stored at inbound height 2, G's own inbound height: G did not skip it
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideFinal, joinInboundHash)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_hint_joinAboveTheFinalPointsInboundHeadDoesNotKill() public {
        (ProofWalkInput memory finalProof,, bytes32 lateJoinHash) = _lateJoinFinalProof();
        (Dispute memory side, StateSnapshot memory sideFinal) = _sideAtThousand(openingInboundHash, 1);
        // a later JOIN at inbound height 4, above F's head: F never consumed it
        bytes32 laterJoinHash = harness.seedInboundBlock(CHANNEL, _joinBlock(lateJoinHash, 4, joiner, 20));

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideFinal, laterJoinHash)
        );

        _assertRejectedBy(side, joiner);
    }

    function test_hint_blockTheChainDoesNotStoreDoesNotKill() public {
        (ProofWalkInput memory finalProof,,) = _lateJoinFinalProof();
        (Dispute memory side, StateSnapshot memory sideFinal) = _sideAtThousand(openingInboundHash, 1);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideFinal, keccak256("an inbound block the chain never held"))
        );

        _assertRejectedBy(side, joiner);
    }

    function test_hint_lateJoinInsideTheSkippedRunKills() public {
        (ProofWalkInput memory finalProof,, bytes32 lateJoinHash) = _lateJoinFinalProof();
        (Dispute memory side, StateSnapshot memory sideFinal) = _sideAtThousand(openingInboundHash, 1);

        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideFinal, lateJoinHash)
        );

        _assertKilledBy(side, joiner);
    }

    // ==================== a missing inbound block in F's walk ====================

    function test_finalWalk_missingInboundBlockInTheRegressionKillRevertsAndSlashesNobody() public {
        (bytes32 unlinkedJoinHash, ProofWalkInput memory finalProof) = _finalProofOverAnUnlinkedJoin();
        // Y's G = 1000' consumed only the opening (inbound 1)
        (StateSnapshot memory sideFinal,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideFinal);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, unlinkedJoinHash));
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeFinalPointRegression,
            _regressionProofWithHint(finalProof, sideFinal, unlinkedJoinHash)
        );

        _assertNobodySlashed(side, joiner);
    }

    function test_finalWalk_missingInboundBlockInTheConflictKillRevertsAndSlashesNobody() public {
        (bytes32 unlinkedJoinHash, ProofWalkInput memory finalProof) = _finalProofOverAnUnlinkedJoin();
        // Y's block 60 commits another snapshot than F and consumed only the opening (inbound 1)
        (StateSnapshot memory sideSixty,) =
            _mathSnapshot(60, _anchorSet(), _balances(90, 100, 0), openingInboundHash, 1);
        Dispute memory side = _sideDispute(sideSixty);

        vm.expectRevert(abi.encodeWithSelector(ErrorInboundMessageBlockNotStored.selector, CHANNEL, unlinkedJoinHash));
        _applyBy(
            joiner,
            side,
            DisputeFraudProofType.DisputeConflictsWithFinalState,
            _conflictProof(finalProof, 0, 0, sideSixty)
        );

        _assertNobodySlashed(side, joiner);
    }

    // ==================== the latest finalized point ====================

    function test_latestFinalized_undecodableFirstBlockOfTheLastMilestoneGivesFalseOnBothChecks() public {
        Dispute memory side = _sideDisputeConflictingAtTheFinalHeight();
        ProofWalkInput memory finalProof = _honestFinalProof();
        StateSnapshot memory sideFinal = _sideFinalAboveTheFinalPoint();
        _assertBothChecksHold(side, finalProof, sideFinal);

        side.input.stateProof.milestones[1].blockConfirmations[0].signedBlock.encodedBlock = hex"deadbeef";

        _assertBothChecksFail(side, finalProof, sideFinal);
    }

    function test_latestFinalized_firstBlockOfTheLastMilestoneOnAnotherForkGivesFalseOnBothChecks() public {
        Dispute memory side = _sideDisputeConflictingAtTheFinalHeight();
        ProofWalkInput memory finalProof = _honestFinalProof();
        StateSnapshot memory sideFinal = _sideFinalAboveTheFinalPoint();
        _assertBothChecksHold(side, finalProof, sideFinal);

        _otherForkAt(side.input.stateProof.milestones[1], 0);

        _assertBothChecksFail(side, finalProof, sideFinal);
    }

    function test_latestFinalized_genesisBlockZeroThatDoesNotWalkFromTheGenesisGivesFalse() public {
        (ProofWalkInput memory finalProof, StateSnapshot memory carolJoined) = _genesisStartWithCarolsJoin();
        // A's unfinal block 0 consumed C's JOIN: G is the fork genesis, and the conflict kills
        MilestoneProof memory run = _genesisRunTo(carolJoined, 1, _signers(ALICE_KEY));
        Dispute memory dispute = _disputeBy(alice, _one(run));
        assertTrue(
            _diamond()
                .isDisputeConflictingWithFinalState(
                    dispute, DisputeConflictsWithFinalState(finalProof, 0, 0, carolJoined)
                ),
            "premise: block 0 walks from the genesis and the conflict kills"
        );

        // block 0 no longer links to the genesis: the walk that decides whether it is final fails
        _breakLinkAt(run, 0);

        assertFalse(
            _diamond()
                .isDisputeConflictingWithFinalState(
                    dispute, DisputeConflictsWithFinalState(finalProof, 0, 0, carolJoined)
                ),
            "an unwalkable block 0 gives no latest finalized point"
        );
    }

    // ==================== cost ====================

    /// The size this guards: N = 32 participants (the staged machine's participant cap; the last one joins above the
    /// anchor), every hop signed by all of them, and the largest final proof the parachain's calldata limit admits next
    /// to a one-hop side dispute (LARGE_FINAL_HOPS hops). F's extra inbound holds A's top-up and the joiner's JOIN, so
    /// the kill walks both. The storage is cooled before the kill, as in a fresh transaction, and the transaction's
    /// cost is the measured execution plus the intrinsic 21,000 and the calldata gas of the encoded call. Calldata
    /// binds first, so the gas check shows that any such regression kill that fits the calldata limit also fits the
    /// gas limit.
    function test_regression_largestKillWithinTheCalldataLimitFitsTheGasLimit() public {
        (address[] memory set, uint256[] memory keys, bytes32 openingHash, bytes32 joinHash) = _seedLargeChannel();
        address[] memory openers = _withoutLast(set);
        uint256[] memory openerKeys = _withoutLastKey(keys);
        uint256[] memory balances = new uint256[](LARGE_PARTICIPANTS);
        // F: LARGE_FINAL_HOPS threshold hops from the anchor, all past A's top-up and the joiner's JOIN (inbound 3)
        MilestoneProof[] memory milestones = new MilestoneProof[](LARGE_FINAL_HOPS);
        StateSnapshot[] memory snapshots = new StateSnapshot[](LARGE_FINAL_HOPS);
        for (uint256 i = 0; i < LARGE_FINAL_HOPS; i++) {
            (snapshots[i],) = _mathSnapshot(60 + 10 * i, set, balances, joinHash, 3);
            milestones[i] = _hopRun(snapshots[i], 1, keys);
        }
        ProofWalkInput memory finalProof = _finalProof(forkId, milestones, snapshots);
        assertEq(
            _diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight,
            60 + 10 * (LARGE_FINAL_HOPS - 1),
            "premise: the last hop of F is final"
        );
        // Y: one hop of the openers to 1000' below A's top-up (inbound 1)
        (StateSnapshot memory sideFinal,) = _mathSnapshot(1000, openers, new uint256[](openers.length), openingHash, 1);
        (Dispute memory side,) =
            _postedDisputeBy(alice, _one(_hopRun(sideFinal, 1, openerKeys)), _entries(sideFinal), sideFinal);
        _commit(side);
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeFinalPointRegression,
            participant: side.input.disputer,
            dispute: side,
            encodedProof: _regressionProof(finalProof, sideFinal)
        });
        bytes memory callData = abi.encodeCall(harness.applyDisputeFraudProofs, (proofs));
        uint256 calldataBytes = callData.length;
        uint256 calldataGas = _calldataGas(callData);

        vm.cool(address(harness));
        vm.prank(joiner);
        uint256 before = gasleft();
        harness.applyDisputeFraudProofs(proofs);
        uint256 executionGas = before - gasleft();
        uint256 transactionGas = TRANSACTION_BASE_GAS + calldataGas + executionGas;

        _assertKilledBy(side, joiner);
        console.log("DisputeFinalPointRegression kill execution gas", executionGas);
        console.log("DisputeFinalPointRegression kill calldata gas", calldataGas);
        console.log("DisputeFinalPointRegression kill transaction gas", transactionGas);
        console.log("DisputeFinalPointRegression kill calldata bytes", calldataBytes);
        assertLt(calldataBytes, MAX_CALLDATA_BYTES, "the kill fits one parachain transaction's calldata");
        // without one more hop it would not (its signed block and its snapshot, without their array offsets): this
        // is the largest final proof the calldata limit admits
        uint256 hopBytes = abi.encode(milestones[0]).length + abi.encode(snapshots[0]).length;
        assertGt(calldataBytes + hopBytes, MAX_CALLDATA_BYTES, "premise: the largest final proof that fits");
        assertLt(transactionGas, MAX_TRANSACTION_GAS, "the kill fits one parachain transaction's gas");
    }

    /// F = 100 consumed TOP_UP_RUN top-ups of E and then L's JOIN. The kill fires whether G sits below the whole run or
    /// at its top, and costs the same: the hint names L's JOIN, so the check reads no skipped block that F's own walk
    /// did not already read. Both checks run on cooled storage, as in a kill. Before the hint, G below the run cost
    /// about 4,953 gas more per skipped block. F's walk itself stays linear in the inbound blocks it consumed.
    function test_regression_hintAddsNoSecondPassOverARunOfTopUps() public {
        bytes32 runTop = openingInboundHash;
        for (uint256 i = 0; i < TOP_UP_RUN; i++) {
            runTop = harness.seedInboundBlock(CHANNEL, _joinBlock(runTop, 2 + i, erin, 10));
        }
        bytes32 lateJoinHash = harness.seedInboundBlock(CHANNEL, _joinBlock(runTop, 2 + TOP_UP_RUN, joiner, 50));
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), lateJoinHash, 2 + TOP_UP_RUN);
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(finalPoint, 1, _joinedKeys())), _entries(finalPoint));
        // the same hop consuming only the opening: F's walk over no extra inbound block
        (StateSnapshot memory openingPoint,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        ProofWalkInput memory openingProof =
            _finalProof(forkId, _one(_hopRun(openingPoint, 1, _anchorKeys())), _entries(openingPoint));
        // Y's G below the run (inbound 1), Y''s G at the run's top
        (StateSnapshot memory belowRun,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory atRunTop,) =
            _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), runTop, 1 + TOP_UP_RUN);
        (Dispute memory side,) =
            _postedDisputeBy(alice, _one(_hopRun(belowRun, 1, _anchorKeys())), _entries(belowRun), belowRun);
        (Dispute memory sideAtTop,) =
            _postedDisputeBy(alice, _one(_hopRun(atRunTop, 1, _anchorKeys())), _entries(atRunTop), atRunTop);
        DisputeFinalPointRegression memory fromBelow =
            DisputeFinalPointRegression(finalProof, belowRun, _joinHint(finalProof, belowRun));
        DisputeFinalPointRegression memory fromTop =
            DisputeFinalPointRegression(finalProof, atRunTop, _joinHint(finalProof, atRunTop));
        assertEq(fromBelow.joinInboundBlockHash, lateJoinHash, "premise: the hint names L's JOIN");
        assertEq(fromTop.joinInboundBlockHash, lateJoinHash, "premise: the hint names L's JOIN");

        vm.cool(address(harness));
        uint256 before = gasleft();
        bool killsFromBelow = _diamond().isDisputeFinalPointRegression(side, fromBelow);
        uint256 gasFromBelow = before - gasleft();
        vm.cool(address(harness));
        before = gasleft();
        bool killsFromTop = _diamond().isDisputeFinalPointRegression(sideAtTop, fromTop);
        uint256 gasFromTop = before - gasleft();
        vm.cool(address(harness));
        before = gasleft();
        _diamond().verifyMilestones(finalProof);
        uint256 finalWalkGas = before - gasleft();
        vm.cool(address(harness));
        before = gasleft();
        _diamond().verifyMilestones(openingProof);
        uint256 openingWalkGas = before - gasleft();

        assertTrue(killsFromBelow, "G below the run: the hint names L's JOIN past the top-ups");
        assertTrue(killsFromTop, "G at the run's top: L's JOIN is the only extra block");
        assertLt(gasFromBelow, gasFromTop + SKIPPED_INBOUND_WALK_GAS, "no skipped block is read a second time");
        assertGt(finalWalkGas, openingWalkGas, "F's walk reads every inbound block it consumed");
        console.log("regression check gas, G below a run of top-ups", gasFromBelow);
        console.log("regression check gas, G at the run's top", gasFromTop);
        console.log("F walk gas per consumed inbound block", (finalWalkGas - openingWalkGas) / (TOP_UP_RUN + 1));
    }

    /// The conflict kill keeps its walk: it proves that the inbound blocks G consumed above F's head hold no JOIN of
    /// an address outside F's participants, and a hint can only prove that one exists. F = 100 consumed the opening;
    /// Y's block 100 consumed CONFLICT_RUN top-ups of E above it. The check is measured on cooled storage with G at two
    /// points of the run; the full kill at the run's top is one parachain transaction. The per-block slope and the
    /// kill's cost give the number of top-ups that exhausts the transaction gas limit.
    function test_conflict_killWalksEveryTopUpAboveTheFinalPointsInbound() public {
        bytes32 runTop = openingInboundHash;
        bytes32 shortRunTop;
        for (uint256 i = 0; i < CONFLICT_RUN; i++) {
            runTop = harness.seedInboundBlock(CHANNEL, _joinBlock(runTop, 2 + i, erin, 10));
            if (i + 1 == SHORT_CONFLICT_RUN) shortRunTop = runTop;
        }
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _anchorSet(), _balances(70, 100, 0), openingInboundHash, 1);
        ProofWalkInput memory finalProof =
            _finalProof(forkId, _one(_hopRun(finalPoint, 1, _anchorKeys())), _entries(finalPoint));
        (StateSnapshot memory shortSide,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), shortRunTop, 1 + SHORT_CONFLICT_RUN);
        (StateSnapshot memory longSide,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), runTop, 1 + CONFLICT_RUN);
        Dispute memory shortDispute = _disputeBy(alice, _one(_hopRun(shortSide, 1, _anchorKeys())));
        Dispute memory longDispute = _sideDispute(longSide);
        DisputeConflictsWithFinalState memory shortProof = DisputeConflictsWithFinalState(finalProof, 0, 0, shortSide);
        DisputeConflictsWithFinalState memory longProof = DisputeConflictsWithFinalState(finalProof, 0, 0, longSide);

        vm.cool(address(harness));
        uint256 before = gasleft();
        bool shortConflicts = _diamond().isDisputeConflictingWithFinalState(shortDispute, shortProof);
        uint256 shortGas = before - gasleft();
        vm.cool(address(harness));
        before = gasleft();
        bool longConflicts = _diamond().isDisputeConflictingWithFinalState(longDispute, longProof);
        uint256 longGas = before - gasleft();
        uint256 gasPerTopUp = (longGas - shortGas) / (CONFLICT_RUN - SHORT_CONFLICT_RUN);

        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeConflictsWithFinalState,
            participant: longDispute.input.disputer,
            dispute: longDispute,
            encodedProof: abi.encode(longProof)
        });
        uint256 calldataGas = _calldataGas(abi.encodeCall(harness.applyDisputeFraudProofs, (proofs)));
        vm.cool(address(harness));
        vm.prank(joiner);
        before = gasleft();
        harness.applyDisputeFraudProofs(proofs);
        uint256 transactionGas = TRANSACTION_BASE_GAS + calldataGas + before - gasleft();

        assertTrue(shortConflicts && longConflicts, "top-ups of F's participants never refuse the conflict");
        _assertKilledBy(longDispute, joiner);
        assertGt(gasPerTopUp, 0, "the conflict walk reads every top-up G consumed above F's head");
        assertLt(transactionGas, MAX_TRANSACTION_GAS, "the kill over CONFLICT_RUN top-ups fits one transaction");
        console.log("conflict check gas per top-up above F's inbound head", gasPerTopUp);
        console.log("conflict kill transaction gas over CONFLICT_RUN top-ups", transactionGas);
        console.log(
            "top-ups that exhaust the transaction gas limit",
            CONFLICT_RUN + (MAX_TRANSACTION_GAS - transactionGas) / gasPerTopUp
        );
    }

    /// The padded-dispute attack: a side dispute padded with tail blocks up to the deployed upload cap, at the largest
    /// participant count, still leaves room for the regression kill with a final proof of FINAL_HOP_BOUND hops. The
    /// kill fits the calldata limit and the gas limit. The bytes per hop of D and of F are logged.
    function test_regression_disputeAtTheUploadCapLeavesRoomForTheKill() public {
        uint256 uploadCap = deployDiamond().getMaxDisputeUploadBytes();
        (address[] memory set, uint256[] memory keys, bytes32 openingHash, bytes32 joinHash) = _seedLargeChannel();
        address[] memory openers = _withoutLast(set);
        uint256[] memory openerKeys = _withoutLastKey(keys);
        uint256[] memory balances = new uint256[](LARGE_PARTICIPANTS);
        // F: FINAL_HOP_BOUND threshold hops from the anchor, all past A's top-up and the joiner's JOIN (inbound 3)
        MilestoneProof[] memory milestones = new MilestoneProof[](FINAL_HOP_BOUND);
        StateSnapshot[] memory snapshots = new StateSnapshot[](FINAL_HOP_BOUND);
        for (uint256 i = 0; i < FINAL_HOP_BOUND; i++) {
            (snapshots[i],) = _mathSnapshot(60 + 10 * i, set, balances, joinHash, 3);
            milestones[i] = _hopRun(snapshots[i], 1, keys);
        }
        ProofWalkInput memory finalProof = _finalProof(forkId, milestones, snapshots);
        // Y: one hop of the openers to 1000' below A's top-up (inbound 1), padded with tail blocks up to the cap
        (StateSnapshot memory sideFinal,) = _mathSnapshot(1000, openers, new uint256[](openers.length), openingHash, 1);
        uint256 oneHopBytes = abi.encode(_disputeBy(alice, _one(_hopRun(sideFinal, 1, openerKeys)))).length;
        uint256 tailBlockBytes =
            abi.encode(_disputeBy(alice, _one(_hopRun(sideFinal, 2, openerKeys)))).length - oneHopBytes;
        uint256 tailBlocks = (uploadCap - oneHopBytes) / tailBlockBytes;
        (Dispute memory side,) = _postedDisputeBy(
            alice, _one(_hopRun(sideFinal, 1 + tailBlocks, openerKeys)), _entries(sideFinal), sideFinal
        );
        uint256 disputeBytes = abi.encode(side).length;
        assertLe(disputeBytes, uploadCap, "premise: the padded dispute passes the upload cap");
        assertGt(disputeBytes + tailBlockBytes, uploadCap, "premise: one more tail block would not");
        _commit(side);
        DisputeFraudProof[] memory proofs = new DisputeFraudProof[](1);
        proofs[0] = DisputeFraudProof({
            proofType: DisputeFraudProofType.DisputeFinalPointRegression,
            participant: side.input.disputer,
            dispute: side,
            encodedProof: _regressionProof(finalProof, sideFinal)
        });
        bytes memory callData = abi.encodeCall(harness.applyDisputeFraudProofs, (proofs));
        uint256 calldataGas = _calldataGas(callData);

        vm.cool(address(harness));
        vm.prank(joiner);
        uint256 before = gasleft();
        harness.applyDisputeFraudProofs(proofs);
        uint256 transactionGas = TRANSACTION_BASE_GAS + calldataGas + before - gasleft();

        _assertKilledBy(side, joiner);
        assertLe(callData.length, MAX_CALLDATA_BYTES, "D at the cap and F at the hop bound fit one transaction");
        assertLt(transactionGas, MAX_TRANSACTION_GAS, "the kill fits one parachain transaction's gas");
        uint256 finalHopBytes = abi.encode(milestones[0]).length + abi.encode(snapshots[0]).length;
        console.log("upload cap bytes", uploadCap);
        console.log("D bytes, one hop of 31 signers", oneHopBytes);
        console.log("D bytes per hop of 31 signers", abi.encode(_hopRun(sideFinal, 1, openerKeys)).length);
        console.log("D bytes per tail block", tailBlockBytes);
        console.log("F bytes per hop of 32 signers", finalHopBytes);
        console.log("kill calldata bytes", callData.length);
        console.log("kill fixed bytes", callData.length - disputeBytes - abi.encode(finalProof).length);
        console.log("kill transaction gas", transactionGas);
    }

    // ---- histories ----

    /// X's milestones and snapshots: the join hop at 60 consuming L's JOIN, then F = 100 where L won 30 from A
    function _honestHistory()
        internal
        view
        returns (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots)
    {
        (StateSnapshot memory joinHop,) = _mathSnapshot(60, _joinedSet(), _balances(100, 100, 50), joinInboundHash, 2);
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), joinInboundHash, 2);
        milestones = _two(_hopRun(joinHop, 1, _joinedKeys()), _hopRun(finalPoint, 1, _joinedKeys()));
        snapshots = _entries(joinHop, finalPoint);
    }

    /// L's final proof of F = 100 (inbound 2) over X
    function _honestFinalProof() internal view returns (ProofWalkInput memory finalProof) {
        (MilestoneProof[] memory milestones, StateSnapshot[] memory snapshots) = _honestHistory();
        finalProof = _finalProof(forkId, milestones, snapshots);
    }

    /// B's dispute: a hop from the anchor to the final point 100 (inbound 1, before L's JOIN) signed by A to E, then
    /// 101 signed by A alone, which consumed L's JOIN. Returns it with its final proof of 100.
    function _ourDisputeWithTheJoinInAnUnfinalTail()
        internal
        view
        returns (Dispute memory dispute, ProofWalkInput memory finalProof)
    {
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(100, _anchorSet(), _balances(70, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory tail,) = _mathSnapshot(101, _joinedSet(), _balances(70, 100, 50), joinInboundHash, 2);
        MilestoneProof memory run = _hopRun(finalPoint, 2, _anchorKeys());
        _commitAt(run, 1, keccak256(abi.encode(tail)), _signers(ALICE_KEY));
        (dispute,) = _postedDisputeBy(bob, _one(run), _entries(finalPoint), tail);
        finalProof = _finalProof(forkId, _one(run), _entries(finalPoint));
        assertEq(_walk(_one(run), _entries(finalPoint)).finalizedSnapshot.blockHeight, 100, "premise: F = 100");
    }

    /// E's top-up (inbound 2) and L's JOIN (inbound 3) stored, and L's final proof of F = 100 that consumed both,
    /// signed by A to E and L
    function _lateJoinFinalProof()
        internal
        returns (ProofWalkInput memory finalProof, bytes32 topUpHash, bytes32 lateJoinHash)
    {
        (topUpHash, lateJoinHash) = _seedTopUpThenLateJoin();
        (StateSnapshot memory finalPoint,) = _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), lateJoinHash, 3);
        finalProof = _finalProof(forkId, _one(_hopRun(finalPoint, 1, _joinedKeys())), _entries(finalPoint));
        assertEq(
            _diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 100, "premise: F = 100 is final"
        );
    }

    /// Y's committed side dispute whose G = 1000' {A to E} consumed up to `inboundHash` at `inboundHeight`
    function _sideAtThousand(bytes32 inboundHash, uint256 inboundHeight)
        internal
        returns (Dispute memory side, StateSnapshot memory sideFinal)
    {
        (sideFinal,) = _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), inboundHash, inboundHeight);
        side = _sideDispute(sideFinal);
    }

    /// L's final proof of F = 60 that consumed L's JOIN stored at inbound height 2 above a block the chain never held:
    /// the run from it down to the anchor's inbound head is missing a block. Returns that JOIN's hash and the proof.
    function _finalProofOverAnUnlinkedJoin()
        internal
        returns (bytes32 unlinkedJoinHash, ProofWalkInput memory finalProof)
    {
        unlinkedJoinHash = harness.seedInboundBlock(
            CHANNEL, _joinBlock(keccak256("an inbound block the chain never held"), 2, joiner, 50)
        );
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(60, _joinedSet(), _balances(90, 100, 50), unlinkedJoinHash, 2);
        finalProof = _finalProof(forkId, _one(_hopRun(finalPoint, 1, _joinedKeys())), _entries(finalPoint));
    }

    /// A's committed side-chain dispute: one hop from the anchor to `latestFinalized`, signed by A to E
    function _sideDispute(StateSnapshot memory latestFinalized) internal returns (Dispute memory dispute) {
        (dispute,) = _postedDisputeBy(
            alice, _one(_hopRun(latestFinalized, 1, _anchorKeys())), _entries(latestFinalized), latestFinalized
        );
        _commit(dispute);
    }

    /// E's top-up at inbound height 2 after the opening, then L's JOIN at inbound height 3: E needs no new signer,
    /// so A to E alone can finalize the top-up below L's JOIN
    function _seedTopUpThenLateJoin() internal returns (bytes32 topUpHash, bytes32 lateJoinHash) {
        MessageBlock memory topUp = _joinBlock(openingInboundHash, 2, erin, 10);
        topUp.totalBalance.amount = 510;
        topUpHash = harness.seedInboundBlock(CHANNEL, topUp);
        MessageBlock memory lateJoin = _joinBlock(topUpHash, 3, joiner, 50);
        lateJoin.totalBalance.amount = 560;
        lateJoinHash = harness.seedInboundBlock(CHANNEL, lateJoin);
    }

    /// L's committed honest dispute over the late JOIN: an early hop at 60 (inbound 1), the join hop at 80 and its
    /// latest finalized point 100 (both inbound 3, signed by A to E and L). Returns the snapshot of 100.
    function _honestDisputeOverTheLateJoin(bytes32 lateJoinHash)
        internal
        returns (Dispute memory dispute, StateSnapshot memory latestFinalized)
    {
        (StateSnapshot memory early,) = _mathSnapshot(60, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        (StateSnapshot memory joinHop,) = _mathSnapshot(80, _joinedSet(), _balances(100, 100, 50), lateJoinHash, 3);
        (latestFinalized,) = _mathSnapshot(100, _joinedSet(), _balances(70, 100, 80), lateJoinHash, 3);
        (dispute,) = _postedDisputeBy(
            joiner,
            _three(
                _hopRun(early, 1, _anchorKeys()),
                _hopRun(joinHop, 1, _joinedKeys()),
                _hopRun(latestFinalized, 1, _joinedKeys())
            ),
            _entries(early, joinHop, latestFinalized),
            latestFinalized
        );
        _commit(dispute);
    }

    /// A to E's final proof of a side-chain point F' = 60 that consumed E's top-up (`topUpHash`, inbound 2)
    function _sideFinalAtSixty(bytes32 topUpHash) internal returns (ProofWalkInput memory finalProof) {
        (StateSnapshot memory sideSixty,) = _mathSnapshot(60, _anchorSet(), _balances(90, 100, 0), topUpHash, 2);
        finalProof = _finalProof(forkId, _one(_hopRun(sideSixty, 1, _anchorKeys())), _entries(sideSixty));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 60, "premise: F' = 60 is final");
    }

    /// The chain snapshot back at the fork genesis {A, B} (inbound head zero), C's JOIN stored after it at inbound
    /// height 1, and A and B's final proof of block 0 that consumed nothing. Returns that proof and the snapshot of a
    /// block 0 {A, B, C} that consumed C's JOIN.
    function _genesisStartWithCarolsJoin()
        internal
        returns (ProofWalkInput memory finalProof, StateSnapshot memory carolJoined)
    {
        harness.seedSnapshot(CHANNEL, genesis);
        (, bytes32 carolJoinHash) = _seedJoin(bytes32(0), 1, carol);
        address[] memory withCarol = new address[](3);
        withCarol[0] = alice;
        withCarol[1] = bob;
        withCarol[2] = carol;
        carolJoined = _snapshotAt(0, withCarol, carolJoinHash, 1);
        StateSnapshot memory zero = _snapshot(0, genesisData.participants);
        finalProof = _finalProof(forkId, _one(_genesisRunTo(zero, 1, _signers(ALICE_KEY, BOB_KEY))), _entries(zero));
        ProofWalkResult memory walk = _diamond().verifyMilestones(finalProof);
        assertTrue(walk.valid, "premise: F walks from the genesis");
        assertEq(walk.finalizedSnapshot.blockHeight, 0, "premise: F is the final block 0");
        assertEq(keccak256(abi.encode(walk.finalizedSnapshot)), keccak256(abi.encode(zero)), "premise: F is block 0");
    }

    /// The cost case's channel: the anchor 50 with the first LARGE_PARTICIPANTS - 1 participants (A first, the others
    /// staged keys) whose opening JOINs are inbound height 1, A's top-up at inbound height 2, and the last
    /// participant's JOIN at inbound height 3. Returns the full set, its keys (A first), the opening and the JOIN hash.
    function _seedLargeChannel()
        internal
        returns (address[] memory set, uint256[] memory keys, bytes32 openingHash, bytes32 joinHash)
    {
        set = new address[](LARGE_PARTICIPANTS);
        keys = new uint256[](LARGE_PARTICIPANTS);
        set[0] = alice;
        keys[0] = ALICE_KEY;
        for (uint256 i = 1; i < LARGE_PARTICIPANTS; i++) {
            keys[i] = 0x5EA7_0000 + i;
            set[i] = vm.addr(keys[i]);
        }
        address[] memory openers = _withoutLast(set);
        openingHash = harness.seedInboundBlock(CHANNEL, _openingInboundOf(openers));
        MessageBlock memory topUp = _joinBlock(openingHash, 2, alice, 10);
        topUp.totalBalance.amount = 100 * openers.length + 10;
        bytes32 topUpHash = harness.seedInboundBlock(CHANNEL, topUp);
        MessageBlock memory lateJoin = _joinBlock(topUpHash, 3, set[LARGE_PARTICIPANTS - 1], 100);
        lateJoin.totalBalance.amount = 100 * LARGE_PARTICIPANTS + 10;
        joinHash = harness.seedInboundBlock(CHANNEL, lateJoin);
        (StateSnapshot memory anchor,) = _mathSnapshot(50, openers, new uint256[](openers.length), openingHash, 1);
        harness.seedSnapshot(CHANNEL, anchor);
    }

    /// L's final proof of F = 60 {A to E, L} that consumed L's JOIN `joinHash` at inbound `inboundHeight`, signed by A
    /// to E and L
    function _finalJoinProofAtSixty(bytes32 joinHash, uint256 inboundHeight)
        internal
        returns (ProofWalkInput memory finalProof)
    {
        (StateSnapshot memory finalPoint,) =
            _mathSnapshot(60, _joinedSet(), _balances(90, 100, 50), joinHash, inboundHeight);
        finalProof = _finalProof(forkId, _one(_hopRun(finalPoint, 1, _joinedKeys())), _entries(finalPoint));
        assertEq(_diamond().verifyMilestones(finalProof).finalizedSnapshot.blockHeight, 60, "premise: F = 60 is final");
    }

    /// A's run 45..65 holding the anchor 50 (its block 50 commits the anchor), signed by A alone
    function _anchorInsideRun() internal view returns (MilestoneProof memory run) {
        (StateSnapshot memory anchor,) = _mathSnapshot(50, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        run = _run(45, 21, keccak256("block 44"), _signers(ALICE_KEY));
        _commitAt(run, 5, keccak256(abi.encode(anchor)), _signers(ALICE_KEY));
    }

    /// A's uncommitted dispute Y: a hop to 100 that commits another snapshot than F, then the hop to
    /// `_sideFinalAboveTheFinalPoint`, both signed by A to E
    function _sideDisputeConflictingAtTheFinalHeight() internal view returns (Dispute memory dispute) {
        (StateSnapshot memory sideHundred,) =
            _mathSnapshot(100, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
        dispute = _disputeBy(
            alice,
            _two(_hopRun(sideHundred, 1, _anchorKeys()), _hopRun(_sideFinalAboveTheFinalPoint(), 1, _anchorKeys()))
        );
    }

    /// Y's latest finalized point 1000' below L's JOIN (inbound 1)
    function _sideFinalAboveTheFinalPoint() internal view returns (StateSnapshot memory sideFinal) {
        (sideFinal,) = _mathSnapshot(1000, _anchorSet(), _balances(100, 100, 0), openingInboundHash, 1);
    }

    /// both kill checks hold against `dispute`: the regression and the conflict at its block (0, 0)
    function _assertBothChecksHold(
        Dispute memory dispute,
        ProofWalkInput memory finalProof,
        StateSnapshot memory latestFinalized
    ) internal view {
        assertTrue(
            _diamond()
                .isDisputeFinalPointRegression(
                    dispute,
                    DisputeFinalPointRegression(finalProof, latestFinalized, _joinHint(finalProof, latestFinalized))
                ),
            "premise: the regression check holds"
        );
        assertTrue(
            _diamond()
                .isDisputeConflictingWithFinalState(
                    dispute, DisputeConflictsWithFinalState(finalProof, 0, 0, latestFinalized)
                ),
            "premise: the conflict check holds"
        );
    }

    /// neither kill check of `_assertBothChecksHold` holds
    function _assertBothChecksFail(
        Dispute memory dispute,
        ProofWalkInput memory finalProof,
        StateSnapshot memory latestFinalized
    ) internal view {
        assertFalse(
            _diamond()
                .isDisputeFinalPointRegression(
                    dispute,
                    DisputeFinalPointRegression(finalProof, latestFinalized, _joinHint(finalProof, latestFinalized))
                ),
            "no latest finalized point: no regression"
        );
        assertFalse(
            _diamond()
                .isDisputeConflictingWithFinalState(
                    dispute, DisputeConflictsWithFinalState(finalProof, 0, 0, latestFinalized)
                ),
            "no latest finalized point: no conflict"
        );
    }

    // ---- staging ----

    /// the calldata cost of `data` (EIP-2028): 16 gas per non-zero byte, 4 per zero byte
    function _calldataGas(bytes memory data) internal pure returns (uint256 gas) {
        for (uint256 i = 0; i < data.length; i++) {
            gas += data[i] == 0 ? 4 : 16;
        }
    }

    /// a Math snapshot at `height` with `participants` holding `balances`, consuming the inbound head `inboundHash`
    /// (its stored height is `inboundHeight`); its deposits are the sum of the balances
    function _mathSnapshot(
        uint256 height,
        address[] memory participants,
        uint256[] memory balances,
        bytes32 inboundHash,
        uint256 inboundHeight
    ) internal view returns (StateSnapshot memory s, bytes memory encodedState) {
        MathState memory state;
        state.number = height;
        state.participants = participants;
        state.balances = new uint256[](participants.length);
        uint256 deposits;
        for (uint256 i = 0; i < participants.length; i++) {
            state.balances[i] = balances[i];
            deposits += balances[i];
        }
        encodedState = abi.encode(state);
        s = _snapshotAt(height, participants, inboundHash, inboundHeight);
        s.snapshotData.stateMachineStateHash = keccak256(encodedState);
        s.snapshotData.totalDeposits.amount = deposits;
    }

    /// A to E's opening JOINs of 100 each at inbound height 1
    function _openingInbound() internal view returns (MessageBlock memory inbound) {
        return _openingInboundOf(_anchorSet());
    }

    /// `openers`' opening JOINs of 100 each at inbound height 1
    function _openingInboundOf(address[] memory openers) internal view returns (MessageBlock memory inbound) {
        inbound.blockHeight = 1;
        inbound.timestamp = block.timestamp;
        inbound.totalBalance.amount = 100 * openers.length;
        inbound.messages = new Message[](openers.length);
        for (uint256 i = 0; i < openers.length; i++) {
            JoinChannel memory join;
            join.channelId = CHANNEL;
            join.participant = openers[i];
            join.balance.amount = 100;
            inbound.messages[i] = Message({
                messageType: MESSAGE_TYPE_JOIN, participant: openers[i], balance: join.balance, data: abi.encode(join)
            });
        }
    }

    /// `disputer`'s dispute posting its auditing data, with the chain's inbound head at upload (L's JOIN)
    function _postedDisputeBy(
        address disputer,
        MilestoneProof[] memory milestones,
        StateSnapshot[] memory snapshots,
        StateSnapshot memory latest
    ) internal view returns (Dispute memory dispute, DisputeAuditingData memory auditingData) {
        dispute = _disputeBy(disputer, milestones);
        dispute.input.latestInboundMessageBlockHash = joinInboundHash;
        dispute.input.lastInboundMessageBlockHeight = 2;
        auditingData.genesisStateSnapshotData = genesisData;
        auditingData.milestoneSnapshots = snapshots;
        auditingData.latestStateSnapshot = latest;
        dispute.postedAuditingData = true;
        dispute.input.disputeAuditingDataHash = keccak256(abi.encode(auditingData));
    }

    /// A's balance, B to E's balance, and L's balance when L is a participant
    function _balances(uint256 aBalance, uint256 othersBalance, uint256 joinerBalance)
        internal
        pure
        returns (uint256[] memory balances)
    {
        balances = new uint256[](6);
        balances[0] = aBalance;
        for (uint256 i = 1; i < 5; i++) {
            balances[i] = othersBalance;
        }
        balances[5] = joinerBalance;
    }

    function _anchorSet() internal view returns (address[] memory set) {
        set = new address[](5);
        set[0] = alice;
        set[1] = bob;
        set[2] = carol;
        set[3] = dave;
        set[4] = erin;
    }

    function _joinedSet() internal view returns (address[] memory set) {
        address[] memory anchorSet = _anchorSet();
        set = new address[](6);
        for (uint256 i = 0; i < 5; i++) {
            set[i] = anchorSet[i];
        }
        set[5] = joiner;
    }

    /// A to E's keys, A (every block's author) first
    function _anchorKeys() internal pure returns (uint256[] memory keys) {
        keys = new uint256[](5);
        keys[0] = ALICE_KEY;
        keys[1] = BOB_KEY;
        keys[2] = CAROL_KEY;
        keys[3] = DAVE_KEY;
        keys[4] = ERIN_KEY;
    }

    function _joinedKeys() internal pure returns (uint256[] memory keys) {
        uint256[] memory anchorKeys = _anchorKeys();
        keys = new uint256[](6);
        for (uint256 i = 0; i < 5; i++) {
            keys[i] = anchorKeys[i];
        }
        keys[5] = JOINER_KEY;
    }

    /// `set` without its last address
    function _withoutLast(address[] memory set) internal pure returns (address[] memory prefix) {
        prefix = new address[](set.length - 1);
        for (uint256 i = 0; i < prefix.length; i++) {
            prefix[i] = set[i];
        }
    }

    /// `keys` without its last key
    function _withoutLastKey(uint256[] memory keys) internal pure returns (uint256[] memory prefix) {
        prefix = new uint256[](keys.length - 1);
        for (uint256 i = 0; i < prefix.length; i++) {
            prefix[i] = keys[i];
        }
    }

    /// the check reverted: `dispute` stays, and neither its disputer nor `challenger` is slashed
    function _assertNobodySlashed(Dispute memory dispute, address challenger) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 1, "the dispute stays committed");
        assertFalse(harness.isSlashed(CHANNEL, dispute.input.disputer), "the disputer is not slashed");
        assertFalse(harness.isSlashed(CHANNEL, challenger), "the challenger is not slashed");
    }

    /// `challenger`'s allegation against `dispute` failed while a second dispute is committed on the same fork: both
    /// stay, `dispute`'s disputer is not punished, the challenger pays
    function _assertBothStayAndChallengerPays(Dispute memory dispute, address challenger) internal view {
        assertEq(harness.commitmentCount(CHANNEL, dispute.input.forkId), 2, "both disputes stay committed");
        assertFalse(harness.isSlashed(CHANNEL, dispute.input.disputer), "dispute submitter not punished");
        assertTrue(harness.isSlashed(CHANNEL, challenger), "the unsupported allegation costs the challenger");
    }

    function _only(Dispute memory dispute) internal pure returns (Dispute[] memory disputes) {
        disputes = new Dispute[](1);
        disputes[0] = dispute;
    }
}
